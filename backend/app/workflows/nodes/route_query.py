from app.core.config import settings
from app.llm.query_rewriter import get_query_rewriter
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：执行查询路由
# 接收当前的 RAG 全局状态字典，返回一个包含更新字段的局部字典（LangGraph 会自动将其合并到全局状态中）
async def route_query(state: RAGState) -> RAGState:
    # 1. 检查全局配置开关。
    # 这是一个非常实用的“降级/灰度”设计，方便我们在本地对比“开启路由”和“关闭路由”的效果。
    if not settings.query_route_enabled:
        # 关闭路由：直接走原始查询，保留 normalize_query 透传的 state["query"]
        # 注意：这里只返回了 route 字段。因为没有改写，所以不需要覆盖 query 字段，
        # 后续的检索节点会直接使用 normalize_query 节点留下的 state["query"]。
        return {"route": "original"}

    # 2. 如果路由功能开启，调用核心优化器执行复杂的 4 步策略（路由判断、改写、HyDE、多路查询）。
    # get_query_rewriter() 获取的是单例对象。
    # 传入用户的具体问题 state["question"]，以及从配置读取的多路查询生成数量。
    result = await get_query_rewriter().optimize(
        question=state["question"],
        multi_query_count=settings.multi_query_count,
    )

    # query 字段被显式覆盖：rewrite/hyde 路径下用改写文本去向向量召回
    # 3. 构建需要更新到全局状态中的字典。
    # 无论走哪种策略，route（最终策略）和 query（真正用于检索的文本）这两个字段是必有的。
    # 特别注意：这里的 result.query 覆盖了原本的查询语句。如果是 rewrite 策略，它就是改写后的长句；
    # 如果是 hyde 策略，它就是大模型生成的假答案文本。
    update: RAGState = {"route": result.route, "query": result.query}

    # 4. 按需（选择性）将其他辅助字段合并到更新字典中。
    # 使用 `is not None` 而不是 `if result.xxx` 是因为要防范空字符串或空列表被误判为 False。

    # 如果走的是 rewrite 策略，保存改写后的文本，供调试和落库使用
    if result.rewritten_query is not None:
        update["rewritten_query"] = result.rewritten_query

    # 如果走的是 hyde 策略，保存大模型生成的假设性答案，供调试和落库使用
    if result.hyde_answer is not None:
        update["hyde_answer"] = result.hyde_answer

    # 如果走的是 multi_queries 策略，保存生成的多个子查询列表，供后续的多路检索节点去并发执行
    if result.multi_queries is not None:
        update["multi_queries"] = result.multi_queries

    # 5. 返回增量更新字典。
    # LangGraph 会在后台自动把这些键值对“打补丁”合并到全局的 RAGState 中，传递给下一个节点。
    return update