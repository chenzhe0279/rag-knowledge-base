from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

# 定义消息角色的字面量类型，限制只能传入这三种系统预设的角色
MessageRoleValue = Literal["user", "assistant", "system"]


# 创建会话的请求模型（接收前端传入的数据）
class ConversationCreate(BaseModel):
    # 会话标题：默认值为"新对话"，最小长度1个字符，最大长度256个字符
    title: str = Field("新对话", min_length=1, max_length=256)


# 读取会话信息的响应模型（返回给前端的数据结构）
class ConversationRead(BaseModel):
    # 允许从任意对象（如 SQLAlchemy ORM 模型实例）的属性中读取数据
    model_config = ConfigDict(from_attributes=True)

    # 会话的唯一标识 ID
    id: UUID
    # 会话标题
    title: str
    # 会话创建时间
    created_at: datetime
    # 会话最后更新时间
    updated_at: datetime


# 读取引用信息的响应模型（用于展示 AI 回答引用的出处）
class CitationRead(BaseModel):
    """assistant 消息引用的 chunk 快照。

    document_id / chunk_id 可能为空（原文档 / chunk 已被删除）。
    """

    # 引用记录自身的唯一标识 ID
    id: UUID
    # 与 prompt 中的「片段 N」编号一致；前端渲染 [N] 角标用，避免按数组下标渲染
    # 在历史接口里被 UUID 排序乱序后串号
    ordinal: int
    # 关联的原始文档 ID，可能为空
    document_id: UUID | None = None
    # 关联的原始文本块 ID，可能为空
    chunk_id: UUID | None = None
    # 文档名称（冗余存储的快照）
    document_name: str
    # 页码，可能为空
    page_no: int | None = None
    # 引用的原文内容
    quote: str

    # 类方法：将数据库的 ORM 引用对象转换为当前的 Pydantic 响应模型
    @classmethod
    def from_orm(cls, citation) -> "CitationRead":
        # 显式取出 ORM 对象的属性，构造并返回 Pydantic 对象
        return cls(
            id=citation.id,
            ordinal=citation.ordinal,
            document_id=citation.document_id,
            chunk_id=citation.chunk_id,
            document_name=citation.document_name,
            page_no=citation.page_no,
            quote=citation.quote,
        )


# 读取消息信息的响应模型
class MessageRead(BaseModel):
    # 消息自身的唯一标识 ID
    id: UUID
    # 消息角色（user / assistant / system）
    role: MessageRoleValue
    # 消息的具体文本内容
    content: str
    # 消息创建时间
    created_at: datetime
    # 消息关联的引用列表，默认通过工厂函数生成一个空列表（防止可变默认值陷阱）
    citations: list[CitationRead] = Field(default_factory=list)

    # 类方法：将数据库的 ORM 消息对象转换为当前的 Pydantic 响应模型
    @classmethod
    def from_orm(cls, message) -> "MessageRead":
        # 构造并返回 Pydantic 对象
        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            created_at=message.created_at,
            # 如果消息角色是 assistant（AI 回答），则遍历其关联的引用记录并转换为 Pydantic 模型列表；
            # 如果是 user 或 system 的消息，则返回空列表（因为用户提问和系统提示没有引用来源）。
            citations=[
                CitationRead.from_orm(c) for c in message.citations
            ] if message.role == "assistant" else [],
        )


# 会话详情的响应模型（包含会话基本信息以及该会话下的所有消息历史）
class ConversationDetail(BaseModel):
    """会话详情：会话本身 + 历史消息（含引用）。"""

    # 嵌套会话的基本信息模型
    conversation: ConversationRead
    # 嵌套该会话下的所有消息列表
    messages: list[MessageRead]


# 发起聊天提问的请求模型
class ChatRequest(BaseModel):
    # 用户提出的问题文本：最小长度为1（不能发空消息），最大长度限制为2000个字符（防止 token 超限或恶意刷屏）
    question: str = Field(min_length=1, max_length=2000)