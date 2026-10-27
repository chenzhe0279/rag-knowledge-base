from app.core.config import settings
from app.retrieval.hybrid_retriever import HybridRetriever
from app.retrieval.vector_retriever import RetrievedChunk
from app.workflows.rag_state import RAGState


# 定义异步节点函数：执行向量检索并根据检索质量决定是否拒答
async def retrieve(state: RAGState) -> RAGState:
    # 0. 获取过滤条件
    filters = state.get("filters")
    # 1. 实例化向量检索器（封装了 pgvector 的检索逻辑）
    retriever = HybridRetriever()

    # 2. 从配置中读取本次检索需要返回的 Top-K 数量
    recall_top_k = settings.retrieval_recall_top_k

    # 3. 判断是否开启了多路查询（Multi-Query）策略，并且确实生成了子查询列表
    if state.get("multi_queries"):
        # 各子查询独立召回，再合并；不在这里做 RRF（倒数排名融合），留给下一期优化
        # 准备一个二维列表，用于装每一次子查询返回的文本块列表
        bundles: list[list[RetrievedChunk]] = []

        # 遍历所有的子查询（使用 or [] 兜底，防止空值报错）
        for sub_query in state["multi_queries"] or []:
            # 对每个子查询执行向量检索，拿到结果列表，并追加到 bundles 中
            bundles.append(await retriever.search(sub_query,  recall_top_k=recall_top_k,  final_top_k=recall_top_k, filters=filters))

        # 【核心逻辑】将多路召回的结果进行去重、合并，并截取最终的 Top-K
        chunks = _merge_chunks(bundles, top_k=recall_top_k)
    else:
        # 如果不是多路查询策略（比如 original, rewrite, hyde），就只用单条查询进行检索
        # 注意：这里的 state["query"] 可能是原问题，也可能是改写后的问题，或者是假设性文档（HyDE）
        chunks = await retriever.search(state["query"], recall_top_k=recall_top_k,  final_top_k=recall_top_k, filters=filters)

    return {"retrieved_chunks": chunks}


# 定义辅助函数：用于合并多路召回的结果，去重并重新排序
def _merge_chunks(bundles: list[list[RetrievedChunk]], top_k: int) -> list[RetrievedChunk]:
    """多路召回结果去重 + 取 Top-K。

    同一个 chunk 可能在多条子查询中都命中；这里保留最高 score，
    再整体按 score 降序取前 top_k。
    """
    # 1. 创建一个字典，键是 chunk_id 的字符串，值是 RetrievedChunk 对象。
    # 使用字典是为了自动实现“按 ID 去重”。
    best: dict[str, RetrievedChunk] = {}

    # 2. 遍历二维列表（外层循环遍历每一路子查询的结果）
    for bundle in bundles:
        # 内层循环遍历当前子查询结果中的每一个 chunk
        for chunk in bundle:
            # 将 UUID 类型的 chunk_id 转为字符串，方便作为字典的 Key
            key = str(chunk.chunk_id)
            # 尝试从字典中取出该 chunk 之前保留的记录
            prev = best.get(key)

            # 3. 【关键比较】：如果当前 chunk 是第一次出现（prev 为 None），
            # 或者当前 chunk 的得分（score）比字典里存的旧记录更高。
            # 因为不同子查询搜出来的同一个 chunk，相似度得分可能不一样，我们要保留最高的。
            if prev is None or (chunk.rrf_score or 0.0) > (prev.rrf_score or 0.0):
                # 用得分更高的替换/写入字典
                best[key] = chunk

    # 4. 对去重后的结果进行排序。
    # best.values() 拿到所有的 chunk 对象。
    # key=lambda c: c.score 指定按照对象的 score 属性排序。
    # reverse=True 表示降序排列（分数从高到低）。
    ranked = sorted(best.values(), key=lambda c: c.score, reverse=True)

    # 5. 截取排名前 top_k 个结果返回，防止多路召回合并后数量爆炸
    return ranked[:top_k]