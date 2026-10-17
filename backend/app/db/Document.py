from datetime import datetime
from uuid import UUID, uuid4
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.base import Base
from app.db.models import DocumentStatus


class Document(Base):
    # 定义数据库中的表名，建表后表名就叫 documents
    __tablename__ = "documents"

    # 主键 ID：使用 PostgreSQL 原生的 UUID 类型，默认自动生成 uuid4
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)

    # 原始文件名（如：员工手册.pdf），最长 512 字符，不允许为空
    name: Mapped[str] = mapped_column(String(512), nullable=False)

    # 文件的 SHA256 哈希值（长度固定64）。作用是“文件级幂等”：
    # 如果用户重复上传同一个文件，可以通过这个字段查重，防止在库里和 COS 里存两份相同的文件。
    # unique=True 保证哈希值唯一，index=True 加上索引加速查询。
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    # 文件的 MIME 类型（如 application/pdf, text/markdown），用于后续选择不同的解析器
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)

    # 文件大小，单位字节。使用 BigInteger 是因为大文件可能超过普通 Integer 的上限
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # ===== 以下是云存储 (腾讯云 COS) 相关的定位信息 =====
    # 存储提供商，默认使用 "cos"
    storage_provider: Mapped[str] = mapped_column(String(32), nullable=False, default="cos")
    # 所在的存储桶名称
    cos_bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    # 在存储桶里的对象键（文件路径，如 documents/2026/10/xxx.pdf）
    cos_object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    # 存储桶所在地域（如 ap-guangzhou）
    cos_region: Mapped[str] = mapped_column(String(64), nullable=False)

    # ===== 状态机相关 =====
    # 文档当前的解析状态（关联定义的 DocumentStatus 枚举：uploading, parsing, indexing, ready, failed）
    # 默认状态是“刚上传完毕 (UPLOADING)”
    status: Mapped[DocumentStatus] = mapped_column(
        String(32), nullable=False, default=DocumentStatus.UPLOADING
    )
    # 如果解析或向量化失败了，把具体的错误信息记录在这里，方便排查。允许为空。
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ===== 时间戳自动管理 =====
    # 记录创建时间，数据库层面自动生成当前时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # 记录最后更新时间，每次修改记录时数据库自动更新此字段
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # ===== 关联关系 (ORM 级联) =====
    # 一个文档被切分后，会对应多个文本块 (DocumentChunk)。
    # cascade="all, delete-orphan" 意思是：如果删除这个 Document 记录，数据库会自动把关联的 chunks 也全删掉，防止产生孤儿数据。
    # relationship() 是 SQLAlchemy 中最核心、最强大的功能之一。简单来说，它是用来建立两个 Python 对象（模型）之间的“情感羁绊”的
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )

