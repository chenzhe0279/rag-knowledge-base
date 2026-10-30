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
    Boolean,
    Float,
    Index,
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

    # __table_args__ 是 SQLAlchemy 的固定写法，用于定义表的额外属性（如索引、约束等）
    __table_args__ = (
        # 索引 1：用于加速向量检索（Vector Search）
        Index(
            # 索引的名称
            "ix_document_chunks_embedding_hnsw",
            # 对模型中的 "embedding" 字段（通常存的是高维向量）建立索引
            "embedding",
            # 使用 PostgreSQL 的 HNSW 算法（一种极其高效的近似最近邻搜索算法）
            postgresql_using="hnsw",
            # 指定向量距离度量方式："vector_cosine_ops" 表示使用余弦相似度来计算向量间的距离
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),

        # 索引 2：用于加速全文检索（Keyword Search / 混合检索）
        Index(
            # 索引的名称
            "ix_document_chunks_content_tsv",
            # 对模型中的 "content_tsv" 字段（通常是 PostgreSQL 的 tsvector 类型，存的是分词后的文本）建立索引
            "content_tsv",
            # 使用 PostgreSQL 的 GIN 索引（倒排索引），这是全文检索性能最高的索引类型
            postgresql_using="gin",
        ),
    )

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


class EvaluationRunStatus(str, Enum):
    """评测 run 生命周期：BackgroundTasks 跑完前 RUNNING；正常结束 COMPLETED；
    主流程异常（不是单条 case 异常）置 FAILED 并写 error_message。"""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class EvaluationRun(Base):
    """RAG 评测任务记录表 (Evaluation Run)。

    作用：
    用于记录一次完整的“自动化评测任务”的宏观数据。
    每次用测试集对 RAG 系统进行整体跑批测试时，会在这里生成一条记录。
    包含三个维度的信息：
    1. 基本信息与进度：如使用的数据集、总题数、完成/失败数。
    2. 汇总得分指标：如平均忠实度、平均召回率、拒答准确率等（由单条明细计算汇总而来）。
    3. 性能与异常：如平均首字延迟、整个任务的起止时间、崩溃时的错误信息。
    """
    # 数据库表名
    __tablename__ = "evaluation_runs"

    # ================= 基础信息 =================
    # 主键 ID（UUID 类型，自动生成）
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    # 评测任务名称（例如："10月30日-知识库v2回归测试"）
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    # 使用的测试集名称
    dataset_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # 数据集总样本数（总共有多少道题）
    dataset_size: Mapped[int] = mapped_column(Integer, nullable=False)
    # 任务当前状态（运行中/已完成/失败）
    status: Mapped[EvaluationRunStatus] = mapped_column(String(16), nullable=False)

    # ================= 进度追踪 =================
    # 计划评测总数
    progress_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 已完成数
    progress_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 单题失败数（非整体崩溃）
    progress_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ================= RAG 评测指标（跑完后才有值，所以允许为 None） =================
    # 忠实度（回答是否基于检索内容，无幻觉）
    faithfulness: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 答案相关性（是否答非所问）
    answer_relevancy: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 上下文精确率（检索出的内容有多少是有用的）
    context_precision: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 上下文召回率（有用的内容有多少被找回了）
    context_recall: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 引用命中率（生成的引用是否准确）
    citation_hit_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 拒答准确率（该拒答时拒答，不该拒答时正常回答）
    refusal_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ================= 性能指标 =================
    # 平均端到端延迟（毫秒）
    avg_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 平均首 Token 延迟（毫秒），反映用户感知的等待时间（拒答 case 不计入）
    avg_first_token_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ================= 异常与生命周期 =================
    # 整体任务失败时的错误信息（Text 适合长文本）
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 开始执行时间
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 结束时间
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 记录创建时间（由数据库自动生成）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # ================= 关联关系 =================
    # 一对多关系：一个 Run 包含多个 Item（具体的题目评测明细）
    items: Mapped[list["EvaluationItem"]] = relationship(
        back_populates="run",
        # 级联删除：删 Run 时自动删除其下的所有 Item，防止产生孤儿数据
        cascade="all, delete-orphan",
        # 依赖数据库底层的 ON DELETE CASCADE 规则去删除，提升性能
        passive_deletes=True,
    )


class EvaluationItem(Base):
    """RAG 评测单条用例（Case）的明细记录表。

    作用：
    用于记录一次评测任务（Run）中，每一道具体题目的“答题全过程快照”。
    一条 Run 记录会对应 N 条 Item 记录（例如测试 100 道题，就有 100 条 Item）。
    核心包含五个维度的信息：
    1. 输入快照：把当时的题目、预期答案、预期文档固化下来，防止未来测试集变动导致历史评测结果失真。
    2. 真实输出：记录系统当时的实际回答、实际引用的文档片段、路由决策等。
    3. 性能指标：单次问答的总耗时、首字延迟等。
    4. 量化得分：RAGAS 评分（忠实度、相关性等），以及拒答是否正确。
    5. 归因分析：如果是错题（Bad Case），记录分类和备注，方便后续针对性优化。
    """
    __tablename__ = "evaluation_items"

    # ================= 基础关联信息 =================
    # 明细记录的唯一主键（UUID）
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    # 外键：所属评测任务的ID（关联 evaluation_runs 表，级联删除，加索引加速查询）
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ================= 输入快照（从评测集固化而来） =================
    # 测试用例的原始 ID（例如数据集里的题号 q_001）
    case_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # 用户提问（题目内容）
    question: Mapped[str] = mapped_column(Text, nullable=False)
    # 期望的参考答案
    expected_answer: Mapped[str] = mapped_column(Text, nullable=False)
    # 期望命中的文档名称列表（存 JSON 数组，如 ["员工手册.pdf", "考勤制度.pdf"]）
    expected_document_names: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # 期望回答中必须包含的关键词列表（存 JSON 数组，用于简单规则校验）
    expected_keywords: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # 这道题是否“应该被系统拒答”（比如超出知识库范围或包含敏感词）
    should_refuse: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # 题目的分类标签（如 ["财务", "复杂查询"]，方便分场景统计得分）
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # ================= 实际运行输出（RAG 系统真实表现） =================
    # 系统实际生成的回答文本
    actual_answer: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 系统实际是否触发了拒答机制
    actual_refused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 系统实际生成的引用片段列表（对应回答里的 [1]、[2]）
    citations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # 系统实际检索出的底层文本块元数据（用于深度排查检索质量）
    retrieved_chunks_meta: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # 查询路由/改写的结果（系统决定怎么去搜，如改写了关键词，允许为空）
    query_route: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Agent 执行过程中的思考/工具调用步骤记录（允许为空）
    agent_steps: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # 答案校验节点的结果（比如是否被校验器判定为幻觉并替换，允许为空）
    verify_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # LangSmith 的调用链路追踪 ID（排查问题专用，允许为空）
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # ================= 性能与异常 =================
    # 生成完整回答的总耗时（毫秒）
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 首个 token 吐出的延迟（毫秒），反映用户等待感，拒答时可能为空
    first_token_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 运行这道题时如果报错，记录的错误信息
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ================= RAGAS 评测指标（跑完后才计算，允许为空） =================
    # 忠实度：回答是否完全基于检索内容，无幻觉
    faithfulness: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 答案相关性：回答是否答非所问
    answer_relevancy: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 上下文精确率：检索出的内容中有多少是真正有用的
    context_precision: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 上下文召回率：所有有用的内容是否都被找回了
    context_recall: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ================= 拒答与引用专项指标 =================
    # 引用是否命中：回答中标注的引用是否真的对上了（拒答 case 为 None，不参与算分）
    citation_hit: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # 拒答行为是否正确：该拒答的时候拒了，或不该拒答的时候正常答了
    refusal_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)

    # ================= Bad Case 归因 =================
    # 是否被标记为“坏例子”（通常由规则初筛，或人工前端修改）
    is_bad_case: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 坏例子的分类（如：“检索失败”、“大模型幻觉”、“格式错误”）
    bad_case_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 人工排查时的详细备注说明
    bad_case_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ================= 生命周期 =================
    # 这条记录在数据库里生成的时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # ================= 关联关系 =================
    # 反向关联：指向所属的宏观评测任务对象
    run: Mapped[EvaluationRun] = relationship(back_populates="items")