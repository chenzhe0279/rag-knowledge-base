from app.core.config import settings
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：用于判断当前检索到的上下文（Context）是否足够回答问题。
# 这是 Agentic RAG 循环中决定“是否继续重试”还是“直接生成答案”的核心裁判员。
async def judge_context(state: RAGState) -> RAGState:
    # 1. 从全局状态中安全获取召回列表。如果没有，给空列表 [] 兜底。
    chunks = state.get("retrieved_chunks", [])

    # 2. 防御性判断：如果什么都没搜到，肯定不够，直接返回 False。
    if not chunks:
        return {"context_is_enough": False}

    # 3. 取出排名第一（得分最高）的文本块。因为数据在前面已经排好序了。
    top = chunks[0]

    # 4.1 优先看精排（Rerank）得分。
    # 如果经过了 Rerank 模型（交叉注意力机制），它的打分比纯向量更准。
    if top.rerank_score is not None:
        is_enough = top.rerank_score >= settings.rerank_min_score

    # 4.2 降级看粗排（向量）得分。
    # 如果没开 Rerank 或者 Rerank 失败了，只能退而求其次看余弦相似度。
    elif top.vector_score is not None:
        is_enough = top.vector_score >= settings.retrieval_min_score

    # 4.3 兜底：如果既没有 Rerank 分数也没有向量分数（比如纯靠关键词命中的块）
    # 缺乏语义佐证，判定为不足以回答问题。
    else:
        is_enough = False

    # 5. 返回局部状态更新字典，告诉工作流图当前的上下文是否充足。
    return {"context_is_enough": is_enough}