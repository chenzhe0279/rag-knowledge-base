from app.core.tracing import traceable
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories.chunk_repo import DocumentChunkRepository
from app.retrieval.filters import RetrievalFilter
from app.retrieval.tokenizer import build_tsquery
from app.retrieval.vector_retriever import RetrievedChunk


# 关键词检索器：负责将用户输入的 query 转换为 tsquery 并利用 ts_rank 获取 Top-K 结果。
# 接口与 VectorRetriever 对齐（都暴露 `search(query, top_k)`），
# 便于 HybridRetriever 把两路当成对称输入做 RRF 融合。
# 适用场景：制度名 / 接口名 / 产品型号 / 编号 / 专有名词等需要精确匹配的查询，
# 向量检索在这些场景下经常被同义近邻干扰，此时关键词字面匹配更准。
class KeywordRetriever:
    # 构造函数：接收数据库异步会话
    def __init__(self, session: AsyncSession) -> None:
        # 实例化文档块仓储类，用于执行底层的全文检索 SQL 逻辑
        self.chunk_repo = DocumentChunkRepository(session)

    # 核心方法：接收用户查询字符串和 Top-K 数量，返回检索结果列表
    @traceable(name=" KeywordRetriever.search", run_type="retriever")
    async def search(self, query: str, top_k: int,  filters: RetrievalFilter | None = None,) -> list[RetrievedChunk]:
        # keyword_search 需要的是 tsquery 字符串，不是原始中文问题。
        # 先走 tokenizer.build_tsquery，把中文切成带引号的 OR 表达式，
        # 否则 PostgreSQL 会把整句中文当成一个 token，导致关键词路 0 命中。
        ts_query = build_tsquery(query)
        if not ts_query:
            return []

        # 调用仓储层的 keyword_search 方法。
        # 内部会利用 PostgreSQL 的全文检索功能去匹配并计算 ts_rank 得分。
        # 返回的 rows 是一个元组列表：(DocumentChunk对象, ts_rank得分)
        rows = await self.chunk_repo.keyword_search(ts_query, top_k,  filters=filters,)

        # 1. 先准备一个空列表，用于存放转换后的结果
        result = []

        # 2. 使用 enumerate 遍历数据库返回的 rows。
        # start=1 表示排名从 1 开始。
        # 因为 rows 里的每一个元素是一个元组 (chunk, ts_rank)，所以这里用 (chunk, ts_rank) 进行解包。
        for rank, (chunk, ts_rank) in enumerate(rows, start=1):
            # 3. 实例化 RetrievedChunk 对象，填入各种字段
            item = RetrievedChunk(
                # ===== 基础字段映射 =====
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_name=chunk.document.name,  # 底层查询做了预加载，不会引发 N+1
                content=chunk.content,
                page_no=chunk.page_no,
                section_path=chunk.section_path,

                # ===== 得分与调试字段（混合检索所需）=====
                # ts_rank 没有上界，但在同一查询内的相对大小可比，作为单路 score 直接透出
                score=ts_rank,

                # 标记数据来源于“关键词路”
                sources=("keyword",),

                # 记录该文本块在本次关键词检索中的排名
                keyword_rank=rank,

                # 记录原始的 ts_rank 得分，供前端调试面板展示
                keyword_score=ts_rank,
            )

            # 4. 将实例化好的对象追加到列表中
            result.append(item)

        # 5. 返回最终组装好的列表
        return result