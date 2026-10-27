from app.core.config import settings
from app.llm.reranker import get_reranker
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：执行重排（Rerank）精排操作。
# 接收当前的 RAG 全局状态，返回增量更新的状态字典。
async def rerank(state: RAGState) -> RAGState:
    # 1. 从状态中安全获取初步检索到的文本块列表（如果没有，给空列表 [] 兜底）。
    chunks = state.get("retrieved_chunks", [])

    # 2. 【前置拦截 / 性能优化】：
    # - 如果配置里关闭了 rerank 开关（用于降级对比），
    # - 或者候选列表长度只有 0 或 1 条（根本不需要排序）。
    # 满足任一条件，直接返回空字典 {}。
    if not settings.rerank_enabled or len(chunks) <= 1:
        return {}

    # 3. 调用 Reranker 实例执行重排。
    # 传入用户的原始查询词 state["query"] 作为基准，以及候选列表 chunks。
    # 内部会请求 DashScope API 打分并重新排序。
    reranked = await get_reranker().rerank(state["query"], chunks)

    # 4. 组装并返回更新后的状态字典。
    # 用切片 `[: settings.retrieval_top_k]` 截取重排后的前 N 名。
    return {"retrieved_chunks": reranked[: settings.retrieval_top_k]}