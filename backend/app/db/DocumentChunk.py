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
from app.db.Document import Document
from app.db.base import Base
from app.db.models import DocumentStatus


class DocumentChunk(Base):
    # 表名：存放文档被切分后的文本块（Chunks）
    __tablename__ = "document_chunks"

    # 主键 ID：使用 PostgreSQL 原生的 UUID 类型
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)

    # 外键：关联到所属的 document.id
    # ondelete="CASCADE"：数据库级别的级联删除。如果父文档被删，数据库会自动删掉这里所有的文本块。
    # index=True：加索引。因为 RAG 检索时，经常需要按文档 ID 过滤，加索引能大幅提升查询速度。
    document_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 文本块的正文内容。使用 Text 类型（不限制长度），不允许为空
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # 【核心】：文本块对应的向量（Embedding）
    # 维度由 settings.embedding_dim（比如 1024）控制。
    # 注意：使用 pgvector 的 Vector 类型，这里存储的是一个浮点数数组（list[float]）
    # 维度由 settings.embedding_dim 控制，迁移时同步固化
    embedding: Mapped[list[float]] = mapped_column(Vector(settings.embedding_dim), nullable=False)

    # ===== 以下是为 RAG 场景特意保留的“溯源”元数据 =====
    # 所在页码（如果是 PDF/Word），允许为空（比如 txt 就没有页码）
    page_no: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 章节路径（比如 "第一章 > 1.2节"），用于告诉大模型这段内容来自哪里，允许为空
    section_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # 该文本块在原文档中的顺序（比如第 1 块、第 2 块...），用于重排上下文
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # 文本块的 MD5 哈希值（或者 SHA256 截断）。
    # 作用：增量索引依据。如果重新解析文档，通过对比 Hash 可以跳过未修改的块，节省大模型 embedding 的费用。
    # md5(content)，第 12 章增量索引依据
    chunk_hash: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    # 扩展元数据（JSONB 格式，极其灵活）。
    # 注意：这里在数据库里真实的列名叫 "metadata"（因为 mapped_column 的第一个参数指定了名字），
    # 但在 Python 代码里叫 extra_metadata。因为 "metadata" 在 SQLAlchemy 里是保留字，直接用作属性名会冲突报错。
    # default=dict 保证每次新建对象时，默认给个空字典 {}，防止传 None 报错。
    extra_metadata: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )

    # 创建时间（数据库自动生成）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 反向 ORM 关联：通过 chunk.document 可以直接拿到它所属的那个 Document 对象
    # relationship() 是 SQLAlchemy 中最核心、最强大的功能之一。简单来说，它是用来建立两个 Python 对象（模型）之间的“情感羁绊”的
    document: Mapped[Document] = relationship(back_populates="chunks")