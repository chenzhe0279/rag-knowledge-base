from dataclasses import dataclass
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import DocumentChunk, Document
from app.retrieval.filters import RetrievalFilter


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

    # 定义异步方法：执行基于向量的检索
    async def vector_search(
            self,
            # 用户的查询向量（通常是用户问题经过 Embedding 模型转化后的浮点数数组）
            query_embedding: list[float],
            # 需要返回的候选文本块数量（Top-K）
            top_k: int,
            filters: RetrievalFilter | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        """按 cosine 距离做 Top-K 向量检索。

        - 仅检索状态为 ready 的文档（避免拿到尚未完成入库的脏 chunk）
        - 返回 (chunk, distance) 列表，distance 越小越相似（pgvector cosine_distance）
        - 用 selectinload 把所属 Document 一并加载，方便上层直接读 document.name
          而不会再去 N 次 lazy load 查询
        """

        # 构建 pgvector 特有的 SQL 表达式：计算数据库中 embedding 列与查询向量之间的余弦距离
        distance = DocumentChunk.embedding.cosine_distance(query_embedding)

        # 开始构建 SQLAlchemy 查询语句
        stmt = (
            # 选择 DocumentChunk 实体，同时将计算出的距离起个别名叫 "distance" 一起查出来
            select(DocumentChunk, distance.label("distance"))
            # 关联 Document 表（INNER JOIN），条件是 Document 的 id 等于 Chunk 的 document_id
            .join(Document, Document.id == DocumentChunk.document_id)
            # 过滤条件
            .where(*_document_filter_conditions(filters))
            # 排序规则：按距离升序排列（距离越小，说明语义越相似，排在越前面）
            .order_by(distance.asc())
            # 限制只取前 K 条
            .limit(top_k)
            # 预加载优化：当你把这一堆 DocumentChunk 查出来之后，请顺着每个 Chunk 身上叫 document 的那个属性，把关联的 Document 数据也一并给我捞出来
            .options(selectinload(DocumentChunk.document))
        )

        # 执行查询，获取所有结果行（每一行是一个包含 Chunk 和 distance 的 Row 对象）
        rows = (await self.session.execute(stmt)).all()

        # 创建一个空列表，准备接收处理后的数据
        result = []

        # 遍历数据库返回的每一行结果
        for chunk, dist in rows:
            # 将对象和强转为 float 的距离值打包成元组，追加到结果列表中
            result.append((chunk, float(dist)))

        # 返回包含 (chunk, distance) 元组的列表
        return result

    # 定义异步方法：执行基于关键词的中文全文检索
    async def keyword_search(self, ts_query: str, top_k: int,  filters: RetrievalFilter | None = None,) -> list[tuple[DocumentChunk, float]]:
        """中文全文检索 Top-K：websearch_to_tsquery + ts_rank。

        ts_query 是 tokenizer.build_tsquery() 生成的 OR 表达式，
        例如 '"差旅" or "报销" or "制度"'。

        - 用 simple 文本搜索配置（content_tokens 已经由 jieba 预分词）
        - 仅命中 status='ready' 文档，避免拿到尚未完成入库的脏 chunk
        - 返回 (chunk, ts_rank) 列表，ts_rank 越大越相关
        """

        # 1. 构建全文检索的查询语句（tsquery）
        # websearch_to_tsquery 的第一个参数必须是 PostgreSQL 的 regconfig 类型，不能是普通的字符串。
        # 如果直接传字符串 'simple'，SQLAlchemy 可能会把它作为普通文本参数处理，导致数据库报错 "function does not exist"。
        # 使用 literal_column("'simple'::regconfig") 可以直接将这段强转语法的字面量注入 SQL，确保 100% 兼容所有版本。
        # 为什么用 'simple' 配置？因为我们在入库前已经用 jieba 做好了完美的预分词（词之间带空格），不需要数据库再乱切了。
        tsquery = func.websearch_to_tsquery(
            literal_column("'simple'::regconfig"),
            ts_query,
        )

        # 2. 计算相关性得分（ts_rank）
        # 根据词汇在文本中出现的频率等维度，算出一个浮动得分。
        rank_expr = func.ts_rank(DocumentChunk.content_tsv, tsquery)

        # 3. 构建完整的 SQLAlchemy 查询语句
        stmt = (
            # 选取 DocumentChunk 实体，并将计算出的得分命名为 "rank"
            select(DocumentChunk, rank_expr.label("rank"))
            # 关联 Document 表，为了去校验文档状态
            .join(Document, Document.id == DocumentChunk.document_id)
            # 过滤条件
            .where(
                # 条件 A：只检索那些已经解析完成（ready）的文档，避免搜到半成品
                *_document_filter_conditions(filters),
                # 条件 B：【核心匹配逻辑】使用 PostgreSQL 的 "@@" 操作符。
                # 判断左边（文本向量 content_tsv）是否匹配右边（查询向量 tsquery）。
                DocumentChunk.content_tsv.op("@@")(tsquery),
            )
            # 排序规则：根据得分降序排列（分数越高的，匹配度越好，排越前面）
            .order_by(rank_expr.desc())
            # 只取前 top_k 条结果
            .limit(top_k)
            # 预加载优化：一次性把关联的 Document 对象查出来，防止后续访问时触发 N+1 查询
            .options(selectinload(DocumentChunk.document))
        )

        # 4. 执行查询，获取所有结果行
        # 每一行是一个元组，包含 (DocumentChunk 对象, 相关性得分)
        rows = (await self.session.execute(stmt)).all()

        # 5. 整理并返回结果
        # 使用列表推导式解包，并将数据库返回的 Decimal 类型的分数强转为 Python 原生的 float 类型
        return [(chunk, float(rank)) for chunk, rank in rows]


# 定义工具函数：根据前端传来的过滤条件，动态生成 SQLAlchemy 的 WHERE 查询子句列表。
# 参数 filters：领域模型中的不可变过滤对象（可能为 None，表示用户没有选任何额外过滤条件）。
def _document_filter_conditions(filters: RetrievalFilter | None) -> list:
    # 1. 【强制基础条件】：默认只能检索“已经处理完成（ready）”的文档。
    # 这是整个 RAG 系统的底线，防止那些正在解析中、或者解析失败的半成品文档被误搜出来。
    conditions = [Document.status == "ready"]

    # 2. 防御性判断：如果前端根本没有传额外过滤条件，直接把基础条件返回。
    if filters is None:
        return conditions

    # 3. 动态追加：文件类型过滤（MIME Types）。
    # 如果用户传了文件类型（如 ["application/pdf"]），就生成一个 IN 查询条件。
    if filters.mime_types:
        conditions.append(Document.mime_type.in_(filters.mime_types))

    # 4. 动态追加：文档创建时间的起始边界。
    # 注意用 `is not None` 而不是 `if filters.created_from`，防止 datetime 的边界值（如 Unix 纪元 0）被误判为 False。
    if filters.created_from is not None:
        conditions.append(Document.created_at >= filters.created_from)

    # 5. 动态追加：文档创建时间的结束边界。
    if filters.created_to is not None:
        conditions.append(Document.created_at <= filters.created_to)

    # 6. 动态追加：指定特定文档 ID 列表进行检索。
    # 如果用户只想在某几篇特定的文档中搜索，就会触发这个 IN 条件。
    if filters.document_ids:
        conditions.append(Document.id.in_(filters.document_ids))

    # 7. 返回组装好的条件列表。
    # 调用方通常会在后续使用：`select(...).where(*conditions)`，利用 Python 的 * 解包语法将所有条件用 AND 连接起来。
    return conditions