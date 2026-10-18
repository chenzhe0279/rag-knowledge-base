from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, DocumentStatus

class DocumentRepository:
    def __init__(self, session: AsyncSession) -> None:
        # 将传入的数据库会话对象保存为实例属性。
        # 这样类中的其他方法（如 get_by_id、add 等）都能通过 self.session 来执行异步 SQL 操作。
        self.session = session

    async def get_by_id(self, document_id: UUID) -> Document | None:
        """
        根据主键 ID 查询文档。
        使用了 SQLAlchemy 2.0 中最推荐的 session.get() 方法，它自带一级缓存，性能最好。
        """
        return await self.session.get(Document, document_id)

    async def get_by_hash(self, file_hash: str) -> Document | None:
        """
        根据文件哈希值查询文档（用于上传时的秒传/去重校验）。
        """
        # 构建 SELECT 语句：SELECT * FROM documents WHERE file_hash = ?
        stmt = select(Document).where(Document.file_hash == file_hash)

        # 执行查询，scalar_one_or_none() 是一个非常好用的方法：
        # 如果查到一条记录，返回该对象；如果没查到，返回 None；如果查到多条（理论上 file_hash 是唯一约束，不会多条），会抛异常。
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def add(self, document: Document) -> Document:
        """
        将新文档添加到数据库会话中。
        """
        # 1. 将对象添加到 session 的待提交队列（此时还在内存中）
        self.session.add(document)

        # 2. 执行 flush 而不是 commit。
        # flush 会立刻向数据库发送 INSERT 语句，让数据库生成主键 ID、默认时间戳等。
        # 但不提交事务，事务的控制权交由上层的业务代码（比如 FastAPI 的依赖注入）统一管理。
        await self.session.flush()

        return document

    async def update_status(self, document_id: UUID, status: DocumentStatus, *, error_message: str | None = None,) -> None:
        """
        更新文档的解析/处理状态。
        注意：这里没有直接写 UPDATE 语句，而是先查出来再修改属性。
        这是 ORM 的标准做法，能自动触发数据库的 onupdate 等钩子，也更安全。
        """
        # 1. 先根据 ID 查出文档
        doc =  await self.get_by_id(document_id)

        # 2. 如果文档不存在，直接返回（静默处理，或者根据业务需要抛异常）
        if doc is None:
            return

        # 3. 更新状态字段
        doc.status = status

        # 4. 处理错误信息：
        # 仅在显式传入时覆盖；保留 None 语义供成功状态清空之前的错误信息。
        # 解释：如果状态变成了 READY（成功），我们需要把之前可能报错留下的 error_message 置为 None（清空）。
        # 所以条件是：只要传了 error_message，或者状态不是 FAILED，就更新 error_message。
        if error_message is not None or status != DocumentStatus.FAILED:
            doc.error_message = error_message

    async def list_paginated(self, page: int, page_size: int, *, status: DocumentStatus | None = None,) -> tuple[list[Document], int]:
        """
        分页查询文档列表。

        :param page: 页码（从 1 开始）
        :param page_size: 每页条数
        :param status: 可选过滤条件，按文档状态过滤
        :return: 返回一个元组 (当前页的数据列表, 总记录数)
        """
        # 1. 计算数据库查询的偏移量 (Offset)
        # 比如第 2 页，每页 10 条，需要跳过前 10 条，offset = (2 - 1) * 10 = 10
        offset = (page - 1) * page_size

        # 2. 构建查询数据列表的 SQL 语句
        items_stmt = (
            select(Document)
            .order_by(Document.created_at.desc())  # 按创建时间降序排列（最新的在最前面）
            .offset(offset)  # 跳过前 offset 条记录
            .limit(page_size)  # 限制最多返回 page_size 条记录
        )

        # 3. 构建查询总记录数的 SQL 语句
        # 相当于 SELECT COUNT(*) FROM documents
        count_stmt = select(func.count()).select_from(Document)

        # 4. 如果传入了 status 过滤条件，则给两个 SQL 语句都追加 WHERE 条件
        if status is not None:
            items_stmt = items_stmt.where(Document.status == status)
            count_stmt = count_stmt.where(Document.status == status)

        # 5. 执行查询获取当前页的数据
        # execute() 拿到结果集，scalars() 取出实体对象，all() 转成列表
        items = (await self.session.execute(items_stmt)).scalars().all()

        # 6. 执行查询获取总记录数
        # scalar_one() 专门用于获取单行单列的聚合结果（比如 COUNT）
        total = (await self.session.execute(count_stmt)).scalar_one()

        # 7. 返回结果，确保 items 是 Python 的 list 类型，total 是 int 类型
        return list(items), int(total)

    async def delete(self, document: Document) -> None:
        """
        删除文档。
        chunks 走 ORM 级联删除（Document.chunks 配了 delete-orphan）。
        当执行删除时，SQLAlchemy 会自动删除所有关联的 document_chunks 记录。
        """
        # 标记该对象为待删除状态。在 flush/commit 时，数据库会执行 DELETE 语句。
        await self.session.delete(document)