from enum import Enum
from datetime import datetime
from uuid import UUID, uuid4
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Computed,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)

from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.base import Base


class DocumentStatus(str, Enum):
    """文档生命周期状态。

    uploading: 已写入 COS、入库前
    parsing:   Docling 解析中
    indexing:  切分 + 向量化 + 写 chunks 中
    ready:     可被检索
    failed:    任意阶段失败
    """

    UPLOADING = "uploading"
    PARSING = "parsing"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"




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
    # 文档缩略图的存储路径
    thumbnail_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
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

    @property
    def thumbnail_url(self) -> str | None:  # 返回给前端的缩略图地址
        if self.thumbnail_object_key is None:  # 没有缩略图
            return None  # 前端显示占位图
        return f"/api/documents/{self.id}/thumbnail"  # 用文档 id 拼出稳定地址
    

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

    # 应用层 jieba 分词结果，空格连接。
    # 入库时由 pipeline 写入，已有数据由 scripts/backfill_content_tokens.py 回填。
    content_tokens: Mapped[str] = mapped_column(Text, nullable=False, default="")

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

    # ===== 中文全文检索专用索引列 =====
    # 这是一个 PostgreSQL 的“生成列（Generated Column）”。
    # 它的值不需要（也不允许）在 Python 代码中手动赋值，完全由数据库根据 content_tokens 自动计算并维护。
    content_tsv: Mapped[str] = mapped_column(
        # 1. 指定数据库列类型为 TSVECTOR。
        # 这是 PostgreSQL 专有的数据类型，专门用于存储经过优化的、带位置信息的“词元（lexemes）”。
        TSVECTOR,

        # 2. 定义生成规则（Computed）。
        # 底层生成的 SQL 是：GENERATED ALWAYS AS (...) STORED。
        # 它告诉数据库：请拿着 content_tokens 列里的内容，使用 'simple' 配置（仅按空格切词、转小写，不做词干还原），
        # 调用 to_tsvector 函数，将其转换为 TSVECTOR 格式。
        Computed("to_tsvector('simple'::regconfig, content_tokens)", persisted=True),

        # 3. 限制该列不能为空。
        # 只要 content_tokens 有值，算出来的 content_tsv 就一定会有值。
        nullable=False,
    )

    # 创建时间（数据库自动生成）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 反向 ORM 关联：通过 chunk.document 可以直接拿到它所属的那个 Document 对象
    # relationship() 是 SQLAlchemy 中最核心、最强大的功能之一。简单来说，它是用来建立两个 Python 对象（模型）之间的“情感羁绊”的
    document: Mapped[Document] = relationship(back_populates="chunks")

class MessageRole(str, Enum):
    """消息角色"""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


# 定义对话模型类，继承 SQLAlchemy 2.0 的基类 Base，对应数据库中的一张表
class Conversation(Base):
    # 指定该模型在数据库中对应的表名为 "conversations"
    __tablename__ = "conversations"

    # 主键 ID：使用 PostgreSQL 原生的 UUID 类型，默认自动生成 uuid4。
    # 使用 UUID 而非自增整数更安全，防止恶意猜测 ID，且适合分布式环境。
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)

    # 对话标题：限制最大长度 256，不允许为空。
    # 设置 default="新对话" 使得用户刚创建会话时，即使没想好名字，也能有一个默认标题。
    title: Mapped[str] = mapped_column(String(256), nullable=False, default="新对话")

    # 开发备注：当前为单用户系统，未来引入多用户登录时，需在此添加 user_id 外键字段。
    # user_id 后面引入用户体系时再加列

    # 记录对话创建的时间戳
    created_at: Mapped[datetime] = mapped_column(
        # 使用带时区的 DateTime 类型；由数据库底层在插入时自动生成当前时间；不允许为空。
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 记录对话最后一次更新的时间戳（如发新消息、修改标题时）
    updated_at: Mapped[datetime] = mapped_column(
        # 使用带时区的 DateTime 类型
        DateTime(timezone=True),
        # 创建记录时自动生成当前时间
        server_default=func.now(),
        # 核心魔法：每次该行数据发生更新时，数据库自动将这个字段刷新为最新的当前时间
        onupdate=func.now(),
        # 不允许为空
        nullable=False,
    )

    # 建立一对多关联关系：一个对话包含多条消息 (Message)。
    # 此属性不会在数据库生成真实字段，仅供 ORM 在 Python 层面查询和操作。
    messages: Mapped[list["Message"]] = relationship(
        # 双向绑定：告诉 ORM，Message 模型里也有一个属性叫 "conversation" 指回当前对话
        back_populates="conversation",
        # 级联删除：如果删除了当前对话，自动把该对话下的所有消息也一并删掉，防止产生孤儿数据
        cascade="all, delete-orphan",
        # 性能优化：删除时让数据库底层的外键级联（ON DELETE CASCADE）去执行，不在 Python 内存里逐个删
        passive_deletes=True,
        # 排序规则：当获取 messages 列表时，默认按照消息的创建时间升序排列（先发的在前）
        order_by="Message.created_at",
    )


class Message(Base):
    # 指定该模型在数据库中对应的表名为 "messages"
    __tablename__ = "messages"

    # 主键 ID：使用 PostgreSQL 原生的 UUID 类型，默认自动生成 uuid4。
    # 使用 UUID 有利于分布式系统及防止主键被轻易猜测。
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)

    # 所属对话的 ID：这是一个外键，将当前消息与 Conversation 表关联起来。
    conversation_id: Mapped[UUID] = mapped_column(
        # 指定类型为 UUID
        PGUUID(as_uuid=True),
        # 外键约束：关联到 conversations 表的 id 列。
        # ondelete="CASCADE" 表示数据库层面的级联删除：当对应的 Conversation 被删除时，这条 Message 也会被数据库自动删除。
        ForeignKey("conversations.id", ondelete="CASCADE"),
        # 不允许为空，每条消息必须属于某个对话
        nullable=False,
        # 建立索引：因为经常会根据 conversation_id 查询该对话下的所有消息，加索引能极大提升查询速度
        index=True,
    )

    # 消息角色：使用自定义的枚举类型 MessageRole（如 USER, ASSISTANT, SYSTEM），存为 16 长度的字符串。
    # 不允许为空，每条消息必须明确是谁说的。
    role: Mapped[MessageRole] = mapped_column(String(16), nullable=False)

    # 消息内容：使用 Text 类型，可以存储极长的文本（如 AI 的长篇回复），不允许为空。
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # 开发备注：预留扩展字段，未来可用于存储模型名称、消耗 token 数、延迟时间等跟踪信息。
    # 扩展元数据：使用 JSONB 字段存储。注意在映射时，数据库列名叫 "metadata"（因为 mapped_column 的第一个参数指定了名字），
    # 而 Python 属性名叫 extra_metadata 是为了避免和 SQLAlchemy 内部的保留属性 metadata 冲突。
    # default=dict 确保在未提供该字段时，默认写入一个空字典 {}。不允许为空。
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)

    # 记录消息创建的时间戳
    created_at: Mapped[datetime] = mapped_column(
        # 使用带时区的 DateTime 类型；由数据库底层在插入时自动生成当前时间；不允许为空。
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 建立多对一关系：多条消息对应一个对话。
    # 此属性允许你通过 message.conversation 直接访问所属的 Conversation 对象。
    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    # 建立一对多关系：一条（AI 回答的）消息可能包含多个引用来源 (AnswerCitation)。
    # 此属性允许你通过 message.citations 获取该消息所引用的文档片段列表。
    citations: Mapped[list["AnswerCitation"]] = relationship(
        # 双向绑定：让 AnswerCitation 模型中有一个属性指向当前消息
        back_populates="message",
        # 级联删除：如果当前消息被删除，自动删除所有依附于它的引用记录
        cascade="all, delete-orphan",
        # 性能优化：删除时依赖数据库底层的级联操作
        passive_deletes=True,
        # 排序规则：获取引用列表时，按 AnswerCitation 模型中的 ordinal 字段升序排列（通常代表在回答中引用的先后顺序）
        order_by="AnswerCitation.ordinal",
    )


class AnswerCitation(Base):
    """assistant 消息引用的 chunk 快照。

    冗余 page_no / quote 作用：原 chunk 后续可能被增量索引覆盖或文档被删除，
    历史会话仍要能展示当时的引用原文。
    """

    # 指定该模型在数据库中对应的表名为 "answer_citations"
    __tablename__ = "answer_citations"

    # 主键 ID：使用 PostgreSQL 原生的 UUID 类型，默认自动生成 uuid4
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)

    # 所属消息的 ID：外键，指向 messages 表
    message_id: Mapped[UUID] = mapped_column(
        # 使用 UUID 类型
        PGUUID(as_uuid=True),
        # 关联 messages 表的主键。级联删除：如果对应的 Message 被删除，这条引用记录也会被数据库自动删掉
        ForeignKey("messages.id", ondelete="CASCADE"),
        # 不允许为空，引用必须属于某条消息
        nullable=False,
        # 加索引：经常需要按 message_id 查询该消息的所有引用，加索引提升查询速度
        index=True,
    )

    # prompt 中给 LLM 看到的「片段 N」编号，从 1 开始。
    # 持久化下来才能保证刷新后引用顺序与 LLM 当时看到的一致（id 是随机 UUID 不能用来排序）
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)

    # 原 chunk / 文档可能被删除，所以 ON DELETE SET NULL，保留快照
    # 关联的原始文档 ID，外键指向 documents 表
    document_id: Mapped[UUID | None] = mapped_column(
        # 使用 UUID 类型
        PGUUID(as_uuid=True),
        # 关联 documents 表。SET NULL：如果原文档被删除了，这里的外键会被数据库自动置为 NULL，保留当前引用快照记录
        ForeignKey("documents.id", ondelete="SET NULL"),
        # 允许为空（因为源文档可能已被删除）
        nullable=True,
    )

    # 关联的原始文本块 ID，外键指向 document_chunks 表
    chunk_id: Mapped[UUID | None] = mapped_column(
        # 使用 UUID 类型
        PGUUID(as_uuid=True),
        # 关联 document_chunks 表。SET NULL：如果原文本块被删除了，外键置为 NULL
        ForeignKey("document_chunks.id", ondelete="SET NULL"),
        # 允许为空（因为源文本块可能被重新切分覆盖或删除）
        nullable=True,
    )

    # 冗余存储的文档名称：防止源文档删除后，历史对话中不知道这段引用出自哪里。限制 512 字符，不允许为空。
    document_name: Mapped[str] = mapped_column(String(512), nullable=False)

    # 冗余存储的页码（可能为空，比如 HTML 文档没有页码）
    page_no: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 冗余存储的引用原文（快照）：即使源 chunk 被修改或删除，这里依然保存着当时 LLM 引用的具体文字内容，使用 Text 类型，不允许为空。
    """
    {
     "sources": ["vector", "keyword"], // 来源：说明这个词是被向量检索、关键词检索、还是两者同时命中的
     "vector_score": 0.85,             // 向量余弦相似度得分
     "keyword_score": 0.42,            // PostgreSQL ts_rank 算出来的得分
     "vector_rank": 3,                 // 在向量检索的 Top-K 列表里，它排第 3 名
     "keyword_rank": 1,                // 在关键词检索的 Top-K 列表里，它排第 1 名
     "rrf_score": 0.0322               // RRF 融合算法最终算出来的综合得分
    }
    """
    quote: Mapped[str] = mapped_column(Text, nullable=False)

    # 混合检索调试元数据：sources / vector_rank / keyword_rank / *_score / rrf_score。
    # 历史 citation 没有这个字段，所以 nullable=True。
    retrieval_meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # 建立多对一关系：多条引用快照对应一条 AI 消息。
    # 与 Message 模型中的 citations 属性构成双向绑定。
    message: Mapped[Message] = relationship(back_populates="citations")
