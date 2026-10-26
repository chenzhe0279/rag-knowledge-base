from dataclasses import dataclass
from typing import get_args

from app.core.logger import get_logger
from app.llm.models import get_chat_model
from app.llm.prompts import (
    build_hyde_messages,
    build_multi_query_messages,
    build_rewrite_messages,
    build_route_messages,
)
from app.workflows.rag_state import QueryRoute

logger = get_logger(__name__)

# 从 typing 模块的 get_args 函数中提取 QueryRoute 类型的所有合法值。
# 假设 QueryRoute 定义为 Literal["original", "rewrite", "hyde", "multi_queries"]，
# 这行代码会动态提取出这些值，生成一个元组：("original", "rewrite", "hyde", "multi_queries")。
# 这样做的好处是“单一数据源”：如果以后在 QueryRoute 里加了一个新策略，这里会自动更新，不用手动改代码。
_VALID_ROUTES: tuple[str, ...] = get_args(QueryRoute)


# 使用 dataclass 装饰器，自动生成 __init__ 等样板代码。
# frozen=True 表示该类的实例是不可变对象（只读），一旦创建，属性不能被修改，保证数据安全。
@dataclass(frozen=True)
# 定义查询路由和优化的统一返回结果类
class QueryRouteResult:
    """Query 优化的统一返回结构。

    - route: 最终采用的策略
    - query: 要喂给向量检索的查询文本（rewrite/hyde 路径下是改写文本，其余是原问题）
    - 余下三个字段按 route 选择性填充，便于前端调试展示和落库
    """

    # 最终选定的路由策略（必定有值）
    route: QueryRoute
    # 最终要送入向量数据库去检索的字符串（必定有值）
    query: str
    # 如果路由策略是 rewrite，这里会存放改写后的独立完整问题；否则为 None
    rewritten_query: str | None = None
    # 如果路由策略是 hyde，这里会存放大模型生成的假设性回答；否则为 None
    hyde_answer: str | None = None
    # 如果路由策略是 multi_queries，这里会存放生成的多条不同角度的子查询列表；否则为 None
    multi_queries: list[str] | None = None


# 定义查询优化器类，这是整个 RAG 链路中“大脑”级别的组件
class QueryRewriter:
    """4 步 Query 优化的协同入口。所有 LLM 调用都走单例 ChatOpenAI。"""

    # =========================================================================
    # 第一步：路由判定（Routing）
    # =========================================================================
    # 决定当前用户的问题，应该采用哪种最合适的检索策略
    async def decide_route(self, question: str) -> QueryRoute:
        # 1. 构建发给大模型的消息。将用户问题塞入专门用于路由判断的 Prompt 模板中
        messages = build_route_messages(question)

        # 2. 异步调用大模型（如 DeepSeek/Qwen），获取路由判断的原始响应
        # 使用 ainvoke 异步方法，防止网络请求阻塞 FastAPI 的主线程
        response = await get_chat_model().ainvoke(messages)

        # 3. 【大模型输出清洗 - 第一层】
        # strip() 去除两边空格，lower() 统一转小写，防止严格的字符串匹配失败。
        raw = _extract_text(response.content).strip().lower()

        # 4. 【大模型输出清洗 - 第二层】
        # 大模型还经常会加戏，比如返回 `original.`、'rewrite' 或 "hyde"。
        # 这里的 strip 把两边的反引号、单引号、双引号、空格和句号统统剥掉，只保留纯单词。
        token = raw.strip("\`'\" .")

        # 5. 校验大模型返回的词到底合不合法
        if token in _VALID_ROUTES:
            # 如果合法，直接把它当做最终策略返回（类型忽略是因为 Python 静态检查无法识别它已被动态校验）
            return token  # type: ignore[return-value]

        # 6. 【兜底容错机制】大模型彻底抽风了，返回了废话或者没按规矩出牌
        # 比如它回复了 "这是一句陈述句"。此时系统绝不能崩溃。
        # 自动降级使用最保守的 "original" 策略（即直接用原问题去检索）。
        logger.warning("query route 模型返回非法值，降级 original: raw=%r", raw)
        return "original"

    # =========================================================================
    # 第二步：问题改写（Rewrite）
    # =========================================================================
    # 把用户残缺、口语化的句子（如“它怎么用”），补全成独立完整的问题（如“Python 的 asyncio 怎么用”）
    async def rewrite(self, question: str) -> str:
        # 构建改写专用的 Prompt
        messages = build_rewrite_messages(question)
        # 异步调用大模型
        response = await get_chat_model().ainvoke(messages)
        # 提取纯文本，去掉首尾空白字符后返回（不需要转小写，因为这是给向量库检索的自然语言句子）
        return _extract_text(response.content).strip()

    # =========================================================================
    # 第三步：假设性文档生成（HyDE）
    # =========================================================================
    # 针对那种“太宏观、词汇太少”的问题（如“什么是死锁”），让大模型先“编”一段专业的回答，再用这段回答去检索。
    # 因为长文本包含的术语更多，能在向量库中匹配到更准确的文档。
    async def hyde(self, question: str) -> str:
        # 构建 HyDE 专用的 Prompt
        messages = build_hyde_messages(question)
        # 异步调用大模型
        response = await get_chat_model().ainvoke(messages)
        # 提取生成的假设性回答内容并清理首尾空白后返回
        return _extract_text(response.content).strip()

    # =========================================================================
    # 第四步：多路查询扩展（Multi-Query）
    # =========================================================================
    # 把一句话拆成好几个不同角度的子查询，同时去向量库搜，最后合并结果，提高召回率。
    async def multi_query(self, question: str, n: int) -> list[str]:
        # 构建多路查询的 Prompt，传入问题数量和具体问题
        messages = build_multi_query_messages(question, n)
        # 异步调用大模型
        response = await get_chat_model().ainvoke(messages)
        # 提取大模型返回的原始文本
        text = _extract_text(response.content)

        # 【重头戏：大模型输出的结构化解析】
        # 期望大模型返回多行纯文本，每行一个查询。
        # 但大模型极大概率会画蛇添足，加上了 "1. ", "- ", "* " 等列表符号。
        # 所以：
        queries = [
            # 逐行遍历：text.splitlines()
            # line.strip(" -*0123456789. ")：把每一行两边的 空格、短横线、星号、0-9的数字 以及 点号 全部剥除。
            # 确保拿到的纯粹是查询语句本身。
            line.strip(" -•*0123456789.、 ")
            for line in text.splitlines()
        ]

        # 第一步：过滤掉空字符串（也就是大模型留下的空行）
        temp_list = []
        for q in queries:
            if q:  # 在 Python 中，非空字符串为 True，空字符串 "" 为 False
                temp_list.append(q)
        # 第二步：截取前 n 个元素
        return temp_list[:n]

    # 【核心重构】：原来庞大的 optimize 方法被拆分了。
    # 新提取出来的 apply_route 方法，只负责“执行”特定路由的改写逻辑，不再负责“判断”用哪个路由。
    async def apply_route(self, question: str, route: QueryRoute, multi_query_count: int) -> QueryRouteResult:
        """已知目标 route 时，按 route 执行对应改写链路并填充 QueryRouteResult。
           与 optimize 的区别：optimize 内部先调 decide_route 判定 route，再调本方法分发；
           apply_route 跳过判定环节，直接按调用方给定的 route 执行
           在 switch_route 决策时由 planner 直接指定 route，复用这套分发逻辑补齐字段，
           避免在 plan_retrieval 节点里再写一遍 if-elif 与降级兜底。
        """
        try:
            # ================= 分支 1：Rewrite（改写） =================
            if route == "rewrite":
                # 去执行改写操作
                rewritten = await self.rewrite(question)

                # 【防呆检查】：万一大模型改写失败返回了空字符串，千万别拿空字符串去向量库检索，检索结果绝对是一团糟。
                if not rewritten:
                    # 果断放弃改写，降级为原问题检索
                    return QueryRouteResult(route="original", query=question)

                # 改写成功！组装结果对象。
                # 注意这里的 query=rewritten，表示后续的检索节点将使用改写后的文本去查。
                return QueryRouteResult(
                    route="rewrite", query=rewritten, rewritten_query=rewritten
                )

            # ================= 分支 2：HyDE（假设性文档） =================
            if route == "hyde":
                # 去生成假设性回答
                hyde_answer = await self.hyde(question)

                # 【防呆检查】：如果生成失败或为空，同样降级
                if not hyde_answer:
                    return QueryRouteResult(route="original", query=question)

                # 组装结果对象。
                # 【核心原理】：在 HyDE 分支下，query 的值变成了 hyde_answer！
                # 因为后面的检索节点，是拿 query 字段去查库的。HyDE 的本质就是用“假答案”当“真问题”去搜！
                # 同时把 hyde_answer 单独存一份，方便前端展示和排查。
                return QueryRouteResult(
                    route="hyde", query=hyde_answer, hyde_answer=hyde_answer
                )

            # ================= 分支 3：Multi-Query（多路查询） =================
            if route == "multi_query":
                # 去扩展生成子查询
                queries = await self.multi_query(question, multi_query_count)

                # 【防呆检查】：如果大模型拆分失败，或者只生成了 1 条，那就失去了多路检索的意义，直接降级。
                if len(queries) < 2:
                    return QueryRouteResult(route="original", query=question)

                # 组装结果对象。
                # 【注意】：在这里，query 依然等于原始的问题 (question)。
                # 因为真正的多路检索是由后续的代码去遍历 multi_queries 列表去执行的。
                # 这里的 query 仅仅作为保底和展示使用。
                return QueryRouteResult(
                    route="multi_query", query=question, multi_queries=queries
                )

            # ================= 分支 4：Rewrite_Multi_Query（改写+多路查询） =================
            # 判断路由器是否选择了“先改写、再多路查询”的组合策略
            if route == "rewrite_multi_query":
                # 第一阶段：把依赖上下文或口语化的问题改写为完整问题
                rewritten = await self.rewrite(question)
                # 如果改写结果为空，说明第一阶段失败
                if not rewritten:
                    # 第一阶段失败时退回原问题检索，避免空字符串进入向量检索
                    return QueryRouteResult(route="original", query=question)
                # 第二阶段：使用改写后的问题扩展多条子查询
                queries = await self.multi_query(rewritten, multi_query_count)
                # 如果子查询少于两条，说明无法形成有意义的多路召回
                if len(queries) < 2:
                    # 保留第一阶段成果，降级为普通 rewrite
                    return QueryRouteResult(
                        # 最终路由降级为 rewrite
                        route="rewrite",
                        # 检索使用改写后的完整问题
                        query=rewritten,
                        # 改写结果继续传给前端和持久化层
                        rewritten_query=rewritten,
                    )
                # 两个阶段都成功，返回组合路由及两个阶段的中间产物
                return QueryRouteResult(
                    # 路由标记为“改写 + 多路查询”
                    route="rewrite_multi_query",
                    # 使用改写后的问题作为基准 Query
                    query=rewritten,
                    # 保存改写结果供调试面板展示
                    rewritten_query=rewritten,
                    # 保存多路子查询供检索节点使用
                    multi_queries=queries,
                )
            # ================= 兜底分支 =================
            # 如果路由返回的是 "original"，或者发生了任何意料之外的情况，直接返回原问题
            return QueryRouteResult(route="original", query=question)
        # 【兜底容错】：如果具体的改写链路（比如调大模型、调分词器）出现异常
        except Exception:
            # 记录堆栈日志，并在日志里带上当前的路由策略和问题，方便排查
            logger.exception(
                "apply_route 失败，降级到 original: route=%s question=%r",
                route,
                question,
            )
            # 保证系统高可用：降级为原问题直接检索
            return QueryRouteResult(route="original", query=question)

    # =========================================================================
    # 核心大脑：分发与执行优化（Optimize）
    # =========================================================================
    # 这是整个类对外暴露的主入口，负责编排上述 4 个步骤，并统一组装返回结果。
    async def optimize(self, question: str, multi_query_count: int) -> QueryRouteResult:
        """按 route 分发并填充结果。任何一步失败都安全降级到 original。"""

        # 【最后一道防线】：开启全局异常捕获。
        # 因为大模型 API 随时可能超时、限流或欠费，如果不加 try-except，整个问答接口直接崩溃（500 错误）。
        try:
            # 先让大模型充当路由器，决定走哪条路
            route = await self.decide_route(question)
        # ================= 异常兜底机制 =================
        except Exception:
            # 如果网络断了、API 限流了，把详细的错误堆栈记录在服务端日志里（方便程序员查 Bug）
            logger.exception(
                "query optimize 失败，降级到 original: question=%r", question
            )
            # 同时，给前端返回一个安全的、可以继续运行的结果（原问题）。
            # 这就是高可用设计的精髓：“用户可能体验不到优化，但服务绝对不能挂”。
            return QueryRouteResult(route="original", query=question)
        # 第二步：既然已经知道怎么走了，把问题、路由、数量交给具体执行者去干活
        return await self.apply_route(question, route, multi_query_count)


# 定义内部函数：从大模型返回的复杂内容中提取纯文本字符串
# 参数类型注解：content 可能是一个字符串，也可能是一个列表（列表元素可能是字符串或字典）
def _extract_text(content: str | list[str | dict]) -> str:
    """兼容 langchain ChatModel 的 content 联合类型"""

    # 1. 最理想的情况：如果大模型直接返回了纯文本字符串（比如 Qwen、DeepSeek 的普通对话）
    if isinstance(content, str):
        # 直接原样返回
        return content

    # 2. 复杂情况：如果返回的是列表（通常发生在多模态模型、或者包含工具调用、引用片段时）
    # 遍历列表中的每一个部分 (part)
    # 检查 part 是否为字典（dict），如果是，则提取其 "text" 字段的值（如果没有该字段则返回空字符串 ""）
    # 最后使用空字符串 "" 将所有提取出来的文本片段拼接成一个完整的纯文本
    return "".join(part.get("text", "") for part in content if isinstance(part, dict))


_rewriter: QueryRewriter | None = None

def get_query_rewriter() -> QueryRewriter:
    global _rewriter
    if _rewriter is None:
        _rewriter = QueryRewriter()
    return _rewriter