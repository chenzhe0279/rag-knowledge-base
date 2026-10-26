from app.core.config import settings
from app.retrieval.vector_retriever import RetrievedChunk
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：观察并评估当前检索到的上下文是否足够。
# 这是 Agentic RAG 循环中“观察（Observe）”的核心环节。
async def observe_context(state: RAGState) -> RAGState:
    # 1. 从全局状态中安全获取检索到的文本块列表。如果没有（比如检索异常），默认给空列表 [] 兜底。
    chunks: list[RetrievedChunk] = state.get("retrieved_chunks", [])

    # 2. 调用底层判定函数，评估当前召回的内容够不够回答问题。
    sufficient = _is_sufficient(chunks)

    #  设置一个默认值 None
    top_score = None

    # 3. 检查第一道防线：列表里到底有没有数据？
    if chunks:
        #  检查第二道防线：第一名的语义得分是不是 None？
        # （如果只是命中了关键词，vector_score 就是 None，不能对它做 round 运算）
        if chunks[0].vector_score is not None:
            # 两重检查都通过，安全地提取得分，保留 4 位小数并赋值
            top_score = round(chunks[0].vector_score, 4)

    # 4. 更新历史步骤记录。
    steps = list(state.get("agent_steps", []))

    if steps:
        # 【关键操作】：取出最后一步的决策记录。
        last = dict(steps[-1])

        # 将本轮的“观察结果”（召回数、最高分、是否足够）回填到上一步的决策记录中。
        # 这就实现了我们在状态定义里提到的：“由 plan_retrieval 追加决策字段、observe_context 回填观察字段，避免分两条记录”。
        last["retrieved_count"] = len(chunks)
        last["top_score"] = top_score
        last["sufficient"] = sufficient

        # 把组装好的最新步骤，覆盖回历史列表的最后一位。
        steps[-1] = last

    # 5. 返回局部状态更新字典。
    return {
        "agent_steps": steps,  # 更新后的完整步骤历史
        # 轮次计数器加 1。如果状态里没这个字段，默认从 0 开始加 1（变成 1）。
        "retrieval_round": state.get("retrieval_round", 0) + 1,
        # 将判定结果写入全局状态，供后续的条件边（Conditional Edge）决定是继续循环还是走向 END。
        "context_sufficient": sufficient,
    }


# 定义内部判定函数：判断当前检索到的上下文是否充足。
def _is_sufficient(chunks: list[RetrievedChunk]) -> bool:
    """与 retrieve._should_refuse 互补：Top1 语义相似度过阈值即视为足够。"""

    # 1. 防御性判断：如果什么都没搜到，肯定不够。
    if not chunks:
        return False

    # 2. 取出排名第一的文本块。
    top = chunks[0]

    # 3. 如果 Top1 只有关键词得分，而没有向量语义得分（说明语义完全不沾边），判定为不够。
    if top.vector_score is None:
        return False

    # 4. 只有当 Top1 的向量相似度得分 >= 配置的阈值（如 0.6）时，才算作充足。
    return top.vector_score >= settings.retrieval_min_score