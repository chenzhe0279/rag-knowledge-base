from app.llm.query_rewriter import get_query_rewriter
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：执行查询规范化（Query Normalization）。
# 这是 RAG 流程的第一步，核心目标是消除多轮对话中的指代和省略，生成可直接用于检索的独立问句。
async def normalize_query(state: RAGState) -> RAGState:
    # 1. 从全局状态中安全获取历史对话记录。
    # 使用 `or []` 兜底：如果 "chat_history" 这个 key 不存在，或者值为 None/空列表，都赋值为空列表 []。
    history = state.get("chat_history") or []

    # 2. 如果当前没有历史记录（比如用户问的第一句话），
    if not history:
        return {"query": state["question"]}

    # 3. 如果存在历史对话，调用 QueryRewriter 的 contextualize 方法。
    rewritten = await get_query_rewriter().contextualize(
        question=state["question"], history=history
    )

    # 4. 返回局部状态更新字典。
    # 将改写后（或者降级后）的完整问句存入 "query" 字段。
    # 后续的 route_query、retrieve 节点都会直接使用这个 "query" 去进行路由判断和向量检索。
    return {"query": rewritten}