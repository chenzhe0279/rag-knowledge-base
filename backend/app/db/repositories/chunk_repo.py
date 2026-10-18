from dataclasses import dataclass
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DocumentChunk


@dataclass(frozen=True)
class ChunkStats:
    """单个文档下的 chunk 长度统计。

    全部 None 表示该文档当前没有任何 chunk（未入库 / 入库失败）。
    """

    total: int
    avg_length: int
    min_length: int
    max_length: int


class DocumentChunkRepository:
    """
    文档块仓储类：专门负责 DocumentChunk 表的数据库操作。
    遵循单一职责原则，将数据访问逻辑与业务逻辑隔离。
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        初始化仓储类。
        依赖注入 AsyncSession，确保与其他仓储共享同一个数据库事务。
        """
        self.session = session

    async def bulk_add(self, chunks: Sequence[DocumentChunk]) -> None:
        """
        批量插入文档块。
        使用批量插入可以大幅减少数据库交互次数，提升性能。

        :param chunks: 文档块序列（可以是 list 或 tuple 等）
        """
        # 1. 防御性编程：如果传入的块为空，直接返回，避免无意义的数据库操作
        if not chunks:
            return

        # 2. 将序列中所有的实体对象一次性加入 SQLAlchemy 的会话缓存中
        self.session.add_all(chunks)

        # 3. 执行 flush 操作。
        # 这会立刻向数据库发送批量 INSERT 语句（获取生成的自增 ID 等）。
        # 但是不会提交事务（不 commit），事务的最终提交权交由外层的 Service 层把控。
        await self.session.flush()

    async def delete_by_document(self, document_id: UUID) -> None:
        """
        根据文档 ID 删除其关联的所有文档块。
        用于重新解析文档前，清理旧的数据。

        :param document_id: 所属文档的 UUID
        """
        # 1. 使用 SQLAlchemy 2.0 风格构建批量 DELETE 语句
        # 等价于原生 SQL: DELETE FROM document_chunks WHERE document_id = ?
        stmt = delete(DocumentChunk).where(DocumentChunk.document_id == document_id)

        # 2. 执行删除操作（同样不 commit，交由外层控制事务）
        await self.session.execute(stmt)

    async def list_paginated_by_document(self, document_id: UUID, page: int, page_size: int,) -> tuple[list[DocumentChunk], int]:
        """
        分页查询指定文档下的所有文本块（chunks）。

        :param document_id: 文档的主键 UUID
        :param page: 当前页码（从 1 开始）
        :param page_size: 每页的数据条数
        :return: 返回一个元组 (当前页的 chunk 列表, 该文档下的 chunk 总数)
        """
        # 1. 计算 SQL 查询的偏移量 (Offset)
        # 比如第 2 页，每页 10 条，offset = (2 - 1) * 10 = 10，表示跳过前 10 条
        offset = (page - 1) * page_size

        # 2. 构建查询数据列表的 SQL 语句
        items_stmt = (
            select(DocumentChunk)
            # 筛选出属于当前 document_id 的所有块
            .where(DocumentChunk.document_id == document_id)
            # 【关键】按 chunk_index 升序排列。因为文档切分是有顺序的，
            # 必须保证查出来的块顺序与原文顺序一致，才能保证后续 RAG 拼接上下文时的连贯性。
            .order_by(DocumentChunk.chunk_index.asc())
            # 跳过前面的数据，实现分页
            .offset(offset)
            # 限制本页只取 page_size 条
            .limit(page_size)
        )

        # 3. 构建查询总数量的 SQL 语句
        count_stmt = (
            select(func.count())
            .select_from(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
        )

        # 4. 执行列表查询
        # execute() 返回结果对象，.scalars() 取出实体对象（即 DocumentChunk 对象），.all() 转为 Python 列表
        items = (await self.session.execute(items_stmt)).scalars().all()

        # 5. 执行总数查询
        # .scalar_one() 专门用于获取单行单列的聚合结果（比如 COUNT），返回一个整数
        total = (await self.session.execute(count_stmt)).scalar_one()

        # 6. 返回结果，确保类型正确（list 和 int）
        return list(items), int(total)

    async def get_for_document(self, document_id: UUID, chunk_id: UUID) -> DocumentChunk | None:
        """按 document_id + chunk_id 双条件查询。

        强校验归属，避免拿 A 文档的 id 越权读 B 文档的 chunk。
        """
        # 构建查询语句：必须同时匹配 chunk 的主键 ID 和它所属的 document_id
        # 这是非常重要的安全设计（防水平越权）。如果只查 chunk_id，用户可能会猜到其他文档的块 ID 并窃取数据。
        stmt = select(DocumentChunk).where(
            DocumentChunk.id == chunk_id,
            DocumentChunk.document_id == document_id,
        )
        # 执行查询，如果查到唯一一条记录则返回该对象，如果没查到则返回 None
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_stats(self, document_id: UUID) -> ChunkStats | None:
        """一条聚合 SQL 拿到 count/avg/min/max，避免在 Python 侧再扫一遍 chunks。"""
        # 1. 获取计算文本长度的 SQL 函数。
        # 使用 char_length 而不是 len，因为这是在数据库层面计算的，char_length 是标准 SQL 函数，按字符数（而不是字节数）计算长度，对中文更友好。
        length = func.char_length(DocumentChunk.content)

        # 2. 构建聚合查询语句。
        # 一次性查出：总块数、平均长度、最小长度、最大长度。
        # label("xxx") 相当于 SQL 里的 AS xxx，给聚合结果起个容易读取的别名，方便后面通过 row.total 访问。
        stmt = select(
            func.count().label("total"),
            func.avg(length).label("avg_len"),
            func.min(length).label("min_len"),
            func.max(length).label("max_len"),
        ).where(DocumentChunk.document_id == document_id)

        # 3. 执行查询，因为聚合函数永远返回一行结果，所以用 .one() 直接获取这一行对象
        row = (await self.session.execute(stmt)).one()

        # 4. 如果总数为 0，说明该文档没有任何 chunk，直接返回 None
        if not row.total:
            return None

        # 5. 组装并返回 ChunkStats 数据类对象。
        # 注意这里的 `or 0` 处理：当 row.total 为 0 时（已在前面被拦截），avg/min/max 可能为 None。
        # 为了防止 int(None) 报错，这里使用 or 0 兜底。
        # 同时因为数据库的聚合函数可能返回 Decimal 类型，这里统一用 int() 强转为整型。
        return ChunkStats(
            total=int(row.total),
            avg_length=int(row.avg_len or 0),
            min_length=int(row.min_len or 0),
            max_length=int(row.max_len or 0),
        )