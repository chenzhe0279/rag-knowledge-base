from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories.chunk_repo import DocumentChunkRepository
from app.ingestion.embedder import get_embeddings
from app.retrieval.filters import RetrievalFilter


# 装饰器：自动生成初始化方法等样板代码，frozen=True 表示生成的对象是只读的（不可变对象）
@dataclass(frozen=True)
# 定义检索结果的数据类（DTO），用于向业务层或前端返回干净的视图数据
class RetrievedChunk:
    """检索结果中单个 chunk 的展示视图。

    score 是统一后的"越大越相似"分数：
    - 向量路：cosine similarity ∈ [0, 1]
    - 关键词路：ts_rank (无固定上界，相对比较有意义)
    - 混合路：RRF 融合分 (参考 rrf_score 字段)

    - sources（来源/召回路径）：说明这个 Chunk 是被哪条路（向量、关键词）找出来的。
    - vector_rank（向量排名）：在向量检索这条路的 Top-K 结果里排第几。
    - keyword_rank（关键词排名）：在关键词检索这条路的 Top-K 结果里排第几。
    - rrf_score（RRF 融合得分）：RRF（Reciprocal Rank Fusion，倒数排名融合）算法算出来的最终综合得分。
    sources / vector_rank / keyword_rank / rrf_score 是调试字段，
    用于让前端面板看清楚"这条引用从哪条路召回、各自第几名"。
    单路检索时只有该路的 rank 有值；混合检索后字段会同时填上。
    """
    # 文本块的唯一 ID
    chunk_id: UUID
    # 所属文档的 ID
    document_id: UUID
    # 所属文档的名称
    document_name: str
    # 文本块的完整正文内容
    content: str
    # 页码（可能为 None）
    page_no: int | None
    # 章节路径（可能为 None）
    section_path: str | None

    # 【核心字段】统一的相似度/相关性得分。
    # 无论底层用的是向量、关键词还是混合检索，最终都统一成这个字段。
    # 保证“越大越相似”，方便上层代码（如拒答阈值判断）统一处理，不用写一堆 if-else。
    score: float

    # ===== 以下是新增的混合检索调试字段 =====

    # 召回来源：记录当前 chunk 是被哪条路（"vector" 或 "keyword"）命中的。
    # 使用 tuple 而不是 list，且用 default_factory 保证每次实例化都生成新的空元组，防止可变对象共享陷阱。
    sources: tuple[str, ...] = field(default_factory=tuple)

    # 向量检索排名：在向量路（Top-K）中排第几名。如果没走向量检索，则为 None。
    vector_rank: int | None = None

    # 向量原始得分：原始 cosine similarity (向量路命中时填充)。
    # 注意：为什么要单独存这个？因为如果走了混合检索，统一字段 score 可能会被 RRF 得分覆盖，
    # 保存原始分是为了前端面板能展示“它原本的余弦相似度是多少”。
    vector_score: float | None = None

    # 关键词检索排名：在关键词路（Top-K）中排第几名。如果没走关键词检索，则为 None。
    keyword_rank: int | None = None

    # 关键词原始得分：原始 ts_rank (关键词路命中时填充)。
    # 同理，保留原始分数供调试面板展示。ts_rank 没有固定上限，所以只能相对比较。
    keyword_score: float | None = None

    # RRF（倒数排名融合）最终得分：混合检索时，把向量排名和关键词排名融合后算出的最终得分。
    rrf_score: float | None = None


# 定义向量检索器类
class VectorRetriever:
    # 构造函数：注入数据库会话
    def __init__(self, session: AsyncSession) -> None:
        # 实例化底层的文档块仓储类，后续通过它执行原生的向量检索 SQL
        self.chunk_repo = DocumentChunkRepository(session)

    # 核心方法：接收用户查询字符串和 Top-K 数量，返回检索结果列表
    async def search(self, query: str, top_k: int, filters: RetrievalFilter | None = None,) -> list[RetrievedChunk]:
        # 单 query 走 aembed_query，DashScope 单条调用更直接
        # 调用 Embedding 模型（如阿里云 DashScope），将用户的文本查询转化为向量（list[float]）
        embedding = await get_embeddings().aembed_query(query)

        # 调用仓储层的方法，拿着向量和 Top-K 去数据库里进行余弦距离检索
        # 返回的是一个元组列表：(DocumentChunk对象, 距离值)
        rows = await self.chunk_repo.vector_search(embedding, top_k,  filters=filters,)

        # 1. 先准备一个空列表
        result = []

        # 2. 遍历数据库返回的原始数据 rows
        # 【关键优化】：使用 enumerate(rows, start=1)，这样不仅能拿到 (chunk, distance)，还能自动拿到排名 rank（从 1 开始）。
        for rank, (chunk, distance) in enumerate(rows, start=1):
            # 注意解包方式：rank 接收序号，(chunk, distance) 接收原本的元组。
            # 此时，每一轮循环里：
            # chunk 是数据库里的一个 DocumentChunk 对象
            # distance 是计算出来的余弦距离（float 类型）

            # 3. 把“距离”反转成“相似度”（因为距离越小越好，相似度越大越好）
            # 提前计算出来，避免下面赋值时重复计算两次
            similarity = 1.0 - distance

            # 4. 创建我们要的 DTO 对象
            item = RetrievedChunk(
                # ===== 基础字段 =====
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_name=chunk.document.name,
                content=chunk.content,
                page_no=chunk.page_no,
                section_path=chunk.section_path,
                score=similarity,
                # ===== 混合检索调试元数据（本次新增）=====
                sources=("vector",),       # 标记此数据来源于“向量路”
                vector_rank=rank,          # 记录在本次向量检索中的排名
                vector_score=similarity,  # 记录原始的向量相似度得分
            )

            # 4. 把创建好的对象塞进列表
            result.append(item)

        # 5. 返回最终组装好的列表
        return result
