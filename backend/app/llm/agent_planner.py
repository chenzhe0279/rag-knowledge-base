import json
from dataclasses import dataclass
from typing import Literal, get_args


from app.core.logger import get_logger
from app.llm.models import get_chat_model
from app.llm.prompts import build_agent_plan_messages
from app.workflows.rag_state import QueryRoute

logger = get_logger(__name__)

# 1. 使用 Literal 定义字面量类型，严格限制 Agent 的“下一步动作”只能从这 4 个字符串中选。
AgentAction = Literal["proceed", "rewrite_query", "switch_route", "refuse"]

# 2. 【核心技巧】：利用 get_args 在运行时提取类型里的值。
# 虽然前面用 Literal 定义了类型，但 Python 是动态语言，我们往往需要在运行时拿到这些具体的字符串来做校验。
# get_args(AgentAction) 会返回一个元组：('proceed', 'rewrite_query', 'switch_route', 'refuse')。
# 把它存到 `_VALID_ACTIONS` 中，后续大模型返回了字符串，我们只需要判断 `if action in _VALID_ACTIONS:` 即可防呆。
_VALID_ACTIONS: tuple[str, ...] = get_args(AgentAction)

# 3. 同理，提取 QueryRoute（检索路由策略）中定义的所有合法值。
# 假设 QueryRoute = Literal["original", "rewrite", "hyde", "multi_query"]
# _VALID_ROUTES 就是 ('original', 'rewrite', 'hyde', 'multi_query')，用于校验大模型给出的路由是否合法。
_VALID_ROUTES: tuple[str, ...] = get_args(QueryRoute)

@dataclass(frozen=True)
class AgentDecision:
    """Agent 一轮决策结果。

    new_query / new_route 仅在对应 action 下有意义；其余 action 下为 None。
    """

    # 1. 下一步行动（action）：大模型根据当前检索状态做出的决策。
    # 类型 AgentAction 通常是一个枚举/Literal，可能包含 "proceed", "rewrite_query", "switch_route", "refuse" 等。
    action: AgentAction

    # 2. 决策原因（reason）：大模型输出的一段自然语言解释。
    reason: str

    # 3. 新的查询词（new_query）：仅在 action == "rewrite_query" 时，大模型才会给出这个字段。
    # 其他 action 下，默认值为 None。
    new_query: str | None = None

    # 4. 新的检索策略（new_route）：仅在 action == "switch_route" 时，大模型才会给出这个字段。
    # 类型 QueryRoute 通常也是枚举（如 original, rewrite, hyde, multi_query），默认值为 None。
    new_route: QueryRoute | None = None

    # 定义 AgentPlanner 类：它是大语言模型（LLM）做决策的薄封装层。
    # 负责将当前状态打包发给 LLM，并解析 LLM 返回的 JSON 决策。


class AgentPlanner:
    """LLM 决策的薄封装。"""

    # 定义异步核心方法：执行一次 Agent 决策规划。
    async def plan(
            self,
            question: str,  # 用户最初提出的原始问题
            current_route: QueryRoute,  # 当前使用的检索路由策略（如 "rewrite", "hyde", "multi_query" 等）
            current_query: str,  # 当前这一轮实际使用的查询词
            previous_steps: list[dict],  # 之前几轮的“思考-行动-观察”历史记录
    ) -> AgentDecision:  # 返回一个封装好的 Agent 决策对象

        # 1. 将历史步骤的结构化列表（包含字典等），格式化为 LLM 能看懂的自然语言文本。
        history = _format_history(previous_steps)

        # 2. 构建发送给 LLM 的消息列表（包含 System Prompt 和 Human Prompt）。
        messages = build_agent_plan_messages(
            question=question,
            current_query=current_query,
            current_route=current_route,
            history=history,
        )

        # 3. 开启异常捕获。大模型 API 容易因网络或限流报错，绝不能让它阻断整个问答流程。
        try:
            # 调用大模型进行异步推理，获取响应。
            response = await get_chat_model().ainvoke(messages)
            # 提取响应中的纯文本，并清理首尾空白字符。
            raw = _extract_text(response.content).strip()
            # 4. 将大模型返回的 JSON 字符串，解析并校验为 AgentDecision 对象。
            return _parse_decision(raw)

        # 5. 【优雅降级】：如果大模型调用失败、超时或解析出错。
        except Exception:
            # 记录详细的异常堆栈日志，方便排查。
            logger.exception("agent planner 调用失败，降级 proceed: question=%r", question)
            # 发生异常时，强行返回一个“继续（proceed）”的决策。
            # 为什么是 proceed？因为检索已经发生了，哪怕 LLM 思考失败，我们也可以直接用当前检索到的结果去生成答案，
            # 总比直接报错让用户什么都看不到要好。
            return AgentDecision(action="proceed", reason="planner_exception")

    # 声明一个模块级的全局变量，用于缓存 AgentPlanner 的单例。


_planner: AgentPlanner | None = None


# 定义工厂函数：用于获取全局唯一的 AgentPlanner 实例。
def get_agent_planner() -> AgentPlanner:
    # 声明这里的 _planner 是模块级别的全局变量，而不是函数内部的局部变量。
    # 如果不写这句，下面的 _planner = AgentPlanner() 会创建一个新的局部变量，导致单例失效。
    global _planner

    # 懒加载（Lazy Initialization）：只有当第一次调用该函数时，才真正实例化对象。
    # 这样可以节省启动时的内存和资源消耗。
    if _planner is None:
        # 实例化 AgentPlanner 并赋值给全局变量
        _planner = AgentPlanner()

    # 返回全局唯一的实例。无论调用多少次，拿到的都是同一个对象。
    return _planner


# 定义内部工具函数：将智能体过去几轮的结构化步骤记录，格式化为一段文本。
def _format_history(steps: list[dict]) -> str:
    """把历史 agent_steps 压成一段可读文本给 LLM 看。"""

    # 1. 防御性判断：如果历史记录是空的（或者为 None），直接返回一个提示词。
    # 告诉 LLM “目前没有任何历史记录”，防止它产生幻觉去编造历史。
    if not steps:
        return "（无）"

    # 2. 创建一个空列表，用于存放每一轮格式化好的文本行。
    lines: list[str] = []

    # 3. 遍历列表里的每一个字典（每一轮检索的详细信息）。
    for step in steps:
        # 4. 使用 f-string 拼接出一行结构清晰、易于 LLM 理解的文本。
        lines.append(
            # 4.1 记录轮次和动作
            f"- round {step.get('round')}: action={step.get('action')}, "
            # 4.2 记录使用的检索策略和查询词。
            # query={step.get('query')!r} 这里的 `!r` 是 repr() 的缩写，
            # 它会自动给查询词加上单引号（如 '差旅'），这样 LLM 就能清晰分辨出哪里是查询词的边界。
            f"route={step.get('route')}, query={step.get('query')!r}, "
            # 4.3 记录召回数量、最高得分以及信息是否充足
            f"retrieved_count={step.get('retrieved_count')}, "
            f"top_score={step.get('top_score')}, "
            f"sufficient={step.get('sufficient')}"
        )

    # 5. 将列表中的所有行，用换行符 \n 拼接成一个完整的多行字符串。
    # 最终传给 LLM 的样子大概长这样：
    # - round 1: action=switch_route, route=hyde, query='...', retrieved_count=5, top_score=0.8, sufficient=False
    # - round 2: action=proceed, route=multi_query, query='...', retrieved_count=10, top_score=0.9, sufficient=True
    return "\n".join(lines)


# 定义内部工具函数：用于从大模型返回的复杂 content 字段中，安全地提取纯文本。
# 参数类型注解 `str | list[str | dict]` 说明：大模型返回的内容，有时是纯字符串，
# 有时是列表（比如多模态模型返回图片+文本，或者工具调用返回复杂的结构）。
def _extract_text(content: str | list[str | dict]) -> str:
    """兼容 langchain ChatModel 的 content 联合类型。"""

    # 1. 最理想的情况：如果返回的本来就是纯字符串（普通对话通常是这样）
    if isinstance(content, str):
        # 直接原样返回
        return content

    # 2. 复杂情况：如果返回的是列表。
    # 使用生成器表达式遍历列表中的每个元素（part）。
    # - `part.get("text", "")`：如果是字典，安全地取出 "text" 字段的值。如果该字段不存在，默认用空字符串 "" 兜底，绝不报 KeyError。
    # - `"".join(...)`：把所有提取出来的文本片段，用空字符串无缝拼接成一个完整的长文本。
    return "".join(part.get("text", "") for part in content if isinstance(part, dict))



# 定义内部工具函数：解析大模型返回的 JSON 字符串，并转换为强类型的 AgentDecision 对象。
# 核心原则：只要发现任何异常（格式不对、字段缺失、类型错误），绝不崩溃，而是安全降级为 "proceed"。
def _parse_decision(raw: str) -> AgentDecision:
    """解析 LLM JSON 输出。任何字段非法 -> 降级 proceed。"""
    # 1. 【格式清洗】大模型极大概率不听话，会在 JSON 外面包一层 Markdown 的代码块符号。
    # 比如返回："```json\n{\n  \"action\": \"proceed\"\n}\n```"
    text = raw.strip()
    if text.startswith("```"):
        # 剥掉前后的反引号
        text = text.strip("```")
        # 如果开头是 json 字样（忽略大小写），把前 4 个字符砍掉
        if text.lower().startswith("json"):
            text = text[4:]
        # 再次清理可能残留的空格或换行
        text = text.strip()

    # 2. 【JSON 解析】尝试把字符串转成 Python 字典
    try:
        # 【JSON 解析】json.loads() 将 JSON 格式的字符串解析为 Python 字典对象。
        data = json.loads(text)
    except json.JSONDecodeError:
        # 如果模型返回的不是合法的 JSON（比如夹杂了废话），记录警告并降级
        logger.warning("agent planner JSON 解析失败，降级 proceed: raw=%r", raw)
        return AgentDecision(action="proceed", reason="planner_parse_failed")

    # 3. 【类型校验】即使 JSON 合法，也不能保证它一定是字典（比如模型返回了个列表或字符串）
    if not isinstance(data, dict):
        return AgentDecision(action="proceed", reason="planner_parse_failed")

    # 4. 【解析 Action】提取动作字段，并做字符串清洗
    action = str(data.get("action", "")).strip().lower()
    # 检查模型返回的 action 是否在我们允许的白名单里（proceed, rewrite_query 等）
    if action not in _VALID_ACTIONS:
        logger.warning("agent planner 返回非法 action=%r，降级 proceed", action)
        return AgentDecision(action="proceed", reason="planner_invalid_action")

    # 5. 【解析 Reason】提取原因字段。如果模型没给，或者给了空字符串，就给个默认值 "(no reason)"
    reason = str(data.get("reason") or "").strip() or "(no reason)"

    # 6. 【解析 New Query】提取新查询词
    new_query_raw = data.get("new_query")
    #  先检查：提取出来的原始数据到底是不是字符串？
    #  如果是字符串，去掉两边的空格后，里面到底有没有实际内容？
    if isinstance(new_query_raw, str) and new_query_raw.strip():
        # 如果上面两个条件都满足：
        # 说明这是一个有效的新查询词，把它强制转成字符串并去除首尾空格，赋值给 new_query
        new_query = str(new_query_raw).strip()
    else:
        # 3. 如果条件不满足（比如传过来的是 None，或者是一个空字符串 "   "，或者是个列表）：
        # 直接赋值为 None，表示“没有有效的新查询词”
        new_query = None

    # 7. 【解析 New Route】提取新路由策略
    new_route_raw = data.get("new_route")
    new_route: QueryRoute | None = None
    # 如果提取到的是字符串，且清洗后在我们的合法路由白名单里
    if isinstance(new_route_raw, str) and new_route_raw.strip().lower() in _VALID_ROUTES:
        # 赋值（忽略静态类型检查警告，因为前面已经通过白名单校验了）
        new_route = new_route_raw.strip().lower()  # type: ignore[assignment]

    # 8. 如果模型决定“改写查询”，但竟然没给新的查询词，直接降级
    # 避免后续拿空字符串去请求 Embedding 模型
    if action == "rewrite_query" and not new_query:
        logger.warning("agent planner action=rewrite_query 缺少 new_query，降级 proceed")
        return AgentDecision(action="proceed", reason="planner_missing_query")

    # 9. 如果模型决定“切换路由”，但没给新的路由策略，直接降级
    if action == "switch_route" and new_route is None:
        logger.warning("agent planner action=switch_route 缺少 new_route，降级 proceed")
        return AgentDecision(action="proceed", reason="planner_missing_route")

    # 10. 所有校验通过，构建最终的不可变决策对象并返回。
    return AgentDecision(
        action=action,  # type: ignore[arg-type]
        reason=reason,
        new_query=new_query,
        new_route=new_route,
    )
