from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

# 定义消息角色的字面量类型，限制只能传入这三种系统预设的角色
MessageRoleValue = Literal["user", "assistant", "system"]

QueryRouteValue = Literal["original", "rewrite", "hyde", "multi_query", "rewrite_multi_query"]

class QueryRouteRead(BaseModel):
    """Query 优化的调试快照。仅 assistant 消息会带，前端用于渲染调试面板。"""

    route: QueryRouteValue
    query: str
    rewritten_query: str | None = None
    hyde_answer: str | None = None
    multi_queries: list[str] | None = None

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

class RetrievalMeta(BaseModel):
    """混合检索调试元数据。

    - sources: 该 chunk 命中的检索路（vector / keyword），两路都命中即"混合"
    - *_rank: 在该路召回结果中的名次（从 1 开始），用于复盘排序
    - vector_score: cosine similarity，绝对值有意义，做拒答阈值用
    - keyword_score: ts_rank，相对值，跨 query 不可比
    - rrf_score: 两路融合分，仅在同一次检索内可比
    """

    # 记录召回来源（如 ["vector"] 或 ["vector", "keyword"]）。
    # 【重要】这里必须使用 Field(default_factory=list)，绝不能写成 `= []`。
    # 因为列表是可变对象，直接赋值会导致所有实例共享同一个列表。
    # default_factory 保证每次实例化时都会创建一个全新的空列表。
    sources: list[str] = Field(default_factory=list)

    # 向量检索排名（如 1, 2, 3）。如果未命中向量路，则为 None。
    vector_rank: int | None = None

    # 向量检索的原始相似度得分。
    # 这个分数是绝对值（0~1 之间），所以可以用于全局的“拒答阈值”判断。
    vector_score: float | None = None

    # 关键词检索排名（如 1, 2, 3）。如果未命中关键词路，则为 None。
    keyword_rank: int | None = None

    # 关键词检索的原始得分（ts_rank）。
    # 这个分数是相对值（没有上界），所以只能用来在同一次查询的结果中排序，不能跨查询比较。
    keyword_score: float | None = None

    # 融合得分（RRF）。数值很小（如 0.016），且只能在当前这次检索的结果中互相比较大小。
    rrf_score: float | None = None



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
    # 混合检索的调试元数据，可能为空
    retrieval_meta: RetrievalMeta | None = None

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


# 定义解析函数：将数据库里 JSONB 类型的原始字典，安全地转为 RetrievalMeta 模型对象
def _parse_retrieval_meta(raw: dict | None) -> RetrievalMeta | None:
    """历史消息没有 retrieval_meta，非法/缺失时静默返回 None。"""

    # 1. 防御性类型检查：如果传入的数据不是字典（比如是 None、字符串或列表），直接返回 None
    if not isinstance(raw, dict):
        return None

    # 2. 开启异常捕获：防止脏数据导致 Pydantic 校验失败，进而引发整个接口崩溃
    try:
        # 使用 Pydantic 的 model_validate 进行严格的类型校验和转换
        return RetrievalMeta.model_validate(raw)

    # 3. 静默容错：如果解析失败（比如历史旧数据缺少必填字段、类型不匹配），直接返回 None。
    # 这种做法能保证“向后兼容”，绝不会因为一条古老的数据格式不对，就让前端的整个历史消息列表加载失败。
    except Exception:
        return None


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
    # assistant消息的query路由调试信息; user / 旧消息为None
    query_route: QueryRouteRead | None = None

    # 定义类方法：将数据库的 Message ORM 对象转换为当前的 Pydantic 响应模型
    @classmethod
    def from_orm(cls, message) -> "MessageRead":  # type: ignore[no-untyped-def]

        # 提前判断当前消息是不是 AI 助手发出的
        is_assistant = message.role == "assistant"

        # ===== 处理引用列表 (citations) =====
        if is_assistant:
            # 如果是 AI 回答：遍历它的引用记录，转换成 Pydantic 模型列表
            citations = [CitationRead.from_orm(c) for c in message.citations]
        else:
            # 如果是用户提问：没有引用，给个空列表
            citations = []

        # ===== 处理查询路由调试信息 (query_route) =====
        if is_assistant:
            # 如果是 AI 回答：解析扩展元数据里的路由快照
            query_route = _parse_query_route(message.extra_metadata)
        else:
            # 如果是用户提问：没有路由信息，给 None
            query_route = None

        # 最后，把所有组装好的数据返回给 Pydantic 模型
        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            created_at=message.created_at,
            citations=citations,  # 传入上面计算好的引用列表
            query_route=query_route,  # 传入上面计算好的路由信息
        )


# 定义内部辅助函数：用于从 JSONB 元数据中解析出查询路由信息
# 参数 metadata 可能是字典，也可能是 None（老数据或者没有额外元数据时）
# 返回值可能是解析好的 QueryRouteRead 模型，也可能解析失败返回 None
def _parse_query_route(metadata: dict | None) -> QueryRouteRead | None:
    """从 messages.metadata 中提取 query_route 字段。

    历史消息没有这个字段，非法/缺失时静默返回 None，不阻断接口。
    """

    # 1. 防御性检查：如果元数据本身就为空（None 或 {}），直接返回 None
    if not metadata:
        return None

    # 2. 尝试从字典中获取 "query_route" 这个键的值
    raw = metadata.get("query_route")

    # 3. 类型检查：如果取出来的值不是字典（比如是 None、字符串、列表等异常情况）
    if not isinstance(raw, dict):
        # 直接返回 None，不再往下解析
        return None

    # 4. 开启异常捕获。因为接下来要交给 Pydantic 做严格校验
    try:
        # 使用 Pydantic 的 model_validate 尝试将字典转换为 QueryRouteRead 模型
        # 如果字段缺失、类型不匹配，Pydantic 会抛出 ValidationError
        return QueryRouteRead.model_validate(raw)
    # 5. 捕获所有异常
    except Exception:
        # 【核心容错机制】：静默返回 None。
        # 绝不能因为调试面板的数据解析失败，就导致整个“获取历史消息列表”的接口直接返回 500 错误。
        # 解析失败无非就是前端看不到调试面板而已，核心的聊天记录必须能正常展示。
        return None


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


