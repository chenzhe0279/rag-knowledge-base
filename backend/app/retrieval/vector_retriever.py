from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories.chunk_repo import DocumentChunkRepository
from app.ingestion.embedder import get_embeddings


# 装饰器：自动生成初始化方法等样板代码，frozen=True 表示生成的对象是只读的（不可变对象）
@dataclass(frozen=True)
# 定义检索结果的数据类（DTO），用于向业务层或前端返回干净的视图数据
class RetrievedChunk:
    """检索结果中单个 chunk 的展示视图。

    score 是 cosine similarity（已统一成"越大越相似"），便于上层做阈值判断。
    """

    # 文本块的唯一 ID
    chunk_id: UUID
    # 所属文档的 ID
    document_id: UUID
    # 所属文档的名称（冗余出来方便展示）
    document_name: str
    # 文本块的完整正文内容
    content: str
    # 页码（可能为 None，比如 Markdown 没有页码）
    page_no: int | None
    # 章节路径（可能为 None）
    section_path: str | None
    # 相似度得分（注意这里是相似度，不是距离，越大越好）
    score: float


# 定义向量检索器类
class VectorRetriever:
    # 构造函数：注入数据库会话
    def __init__(self, session: AsyncSession) -> None:
        # 实例化底层的文档块仓储类，后续通过它执行原生的向量检索 SQL
        self.chunk_repo = DocumentChunkRepository(session)

    # 核心方法：接收用户查询字符串和 Top-K 数量，返回检索结果列表
    async def search(self, query: str, top_k: int) -> list[RetrievedChunk]:
        # 单 query 走 aembed_query，DashScope 单条调用更直接
        # 调用 Embedding 模型（如阿里云 DashScope），将用户的文本查询转化为向量（list[float]）
        embedding = await get_embeddings().aembed_query(query)

        # 调用仓储层的方法，拿着向量和 Top-K 去数据库里进行余弦距离检索
        # 返回的是一个元组列表：(DocumentChunk对象, 距离值)
        rows = await self.chunk_repo.vector_search(embedding, top_k)

        # 1. 先准备一个空列表
        result = []

        # 2. 遍历数据库返回的原始数据 rows
        for chunk, distance in rows:
            # 此时，每一轮循环里：
            # chunk 是数据库里的一个 DocumentChunk 对象
            # distance 是计算出来的余弦距离（float 类型）

            # 3. 创建我们要的 DTO 对象
            item = RetrievedChunk(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_name=chunk.document.name,
                content=chunk.content,
                page_no=chunk.page_no,
                section_path=chunk.section_path,
                score=1.0 - distance,  # 把“距离”反转成“相似度”
            )

            # 4. 把创建好的对象塞进列表
            result.append(item)

        # 5. 返回最终组装好的列表
        return result
