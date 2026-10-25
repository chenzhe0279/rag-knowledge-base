from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.llm.prompts import REFUSAL_ANSWER
from app.retrieval.hybrid_retriever import HybridRetriever
from app.retrieval.vector_retriever import VectorRetriever, RetrievedChunk
from app.workflows.rag_state import RAGState


# 定义异步节点函数：执行向量检索并根据检索质量决定是否拒答
async def retrieve(state: RAGState) -> RAGState:
    # 0. 获取过滤条件
    filters = state.get("filters")
    # 1. 实例化向量检索器（封装了 pgvector 的检索逻辑）
    retriever = HybridRetriever()

    recall_top_k = settings.retrieval_recall_top_k

    # 2. 从配置中读取本次检索需要返回的 Top-K 数量
    final_top_k = settings.retrieval_top_k

    # 3. 判断是否开启了多路查询（Multi-Query）策略，并且确实生成了子查询列表
    if state.get("multi_queries"):
        # 各子查询独立召回，再合并；不在这里做 RRF（倒数排名融合），留给下一期优化
        # 准备一个二维列表，用于装每一次子查询返回的文本块列表
        bundles: list[list[RetrievedChunk]] = []

        # 遍历所有的子查询（使用 or [] 兜底，防止空值报错）
        for sub_query in state["multi_queries"] or []:
            # 对每个子查询执行向量检索，拿到结果列表，并追加到 bundles 中
            bundles.append(await retriever.search(sub_query,  recall_top_k=recall_top_k,  final_top_k=final_top_k, filters=filters))

        # 【核心逻辑】将多路召回的结果进行去重、合并，并截取最终的 Top-K
        chunks = _merge_chunks(bundles, top_k=final_top_k)
    else:
        # 如果不是多路查询策略（比如 original, rewrite, hyde），就只用单条查询进行检索
        # 注意：这里的 state["query"] 可能是原问题，也可能是改写后的问题，或者是假设性文档（HyDE）
        chunks = await retriever.search(state["query"], recall_top_k=recall_top_k,  final_top_k=final_top_k, filters=filters)

    # 4. 触发拒答机制的判定逻辑：
    # 条件 A: chunks 为空列表（完全没搜到）
    # 条件 B: 得分最高的那条（chunks[0]）的分数，依然低于我们在配置文件中设定的最低阈值（比如 0.6）
    refused = _should_refuse(chunks)

    # 5. 构建要返回给 LangGraph 的状态更新字典
    update: RAGState = {
        "retrieved_chunks": chunks,  # 存入检索到的文本块列表
        "refused": refused,  # 存入是否拒答的布尔标记
    }

    # 6. 如果判定为拒答，直接把最终的回答设置为预设的拒答文案
    if refused:
        update["answer"] = REFUSAL_ANSWER

    # 返回局部更新的状态字典，供下一个节点使用
    return update


# 定义辅助函数：用于判定混合检索后的结果，是否应该触发“拒答”机制
def _should_refuse(chunks: list[RetrievedChunk]) -> bool:
    """混合检索后的拒答判定，仅看 Top1 的语义相关度。"""

    # 1. 防御性判断：如果检索结果为空列表，说明完全没找到任何相关内容，必须拒答。
    if not chunks:
        return True

    # 2. 取出排名第一（综合得分最高）的文本块。
    # 因为数据已经排好序了，Top1 代表了本次检索的最优结果。
    top = chunks[0]

    # 3. 【核心业务逻辑】：判断 Top1 是否缺乏“语义佐证”。
    # 在混合检索中，如果一个块仅靠关键词（ts_rank）命中，它的 vector_score 就是 None。
    # 为什么这种情况要拒答？因为纯字面匹配很容易产生误导（比如用户问“Python”，搜到了包含“Python”字样的无关代码）。
    # 如果 Top1 连向量语义分都没有，说明大模型认为它和用户问题“毫不相干”，这种结果送给 LLM 极易产生幻觉，不如直接拒答。
    if top.vector_score is None:
        return True  # Top1 仅命中关键词路，缺乏语义佐证

    # 4. 如果 Top1 有向量相似度得分，则将其与配置文件中设定的最低阈值（如 0.6）进行比较。
    # 如果低于阈值，说明即使是第一名，语义相似度也太低了，判定为“不可用”，返回 True 触发拒答。
    # 如果大于等于阈值，说明检索质量合格，返回 False，允许继续走大模型生成流程。
    return top.vector_score < settings.retrieval_min_score


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