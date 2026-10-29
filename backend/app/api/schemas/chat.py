from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.observability import build_trace_url
from app.retrieval.filters import RetrievalFilter

# 定义消息角色的字面量类型，限制只能传入这三种系统预设的角色
MessageRoleValue = Literal["user", "assistant", "system"]

QueryRouteValue = Literal["original", "rewrite", "hyde", "multi_query", "rewrite_multi_query"]

# 定义 Agent 动作的字面量类型（Literal）。
# 严格限制 Agent 只能执行这 5 种动作，防止大模型胡编乱造出未知的 action。
AgentActionValue = Literal["initial", "proceed", "rewrite_query", "switch_route", "refuse"]


class AgentStep(BaseModel):
    """Agentic RAG 单轮决策 + 观察快照。

    plan_retrieval 先填决策字段 (round / action / reason / route / query)，
    retrieve 跑完后 observe_context 回填观察字段 (retrieved_count / top_score / sufficient)
    """

    # 当前是第几轮思考（如 1, 2, 3）
    round: int

    # 本轮大模型做出的决策动作（如 "proceed", "rewrite_query" 等）
    action: AgentActionValue

    # 大模型做出该决策的推理原因（自然语言解释）
    reason: str

    # 本轮采用的检索路由策略（如 "original", "hyde", "multi_query"）
    route: QueryRouteValue

    # 本轮实际使用的查询词
    query: str

    # ================= 第二阶段：观察字段（由 observe_context 节点回填） =================
    # 注意：这些字段默认值为 None，因为在 plan 阶段它们是未知的，必须等检索完成后才能填上。

    # 本轮检索召回的文本块数量
    retrieved_count: int | None = None

    # 本轮召回的最高语义相似度得分
    top_score: float | None = None

    # 综合评估：本轮召回的内容是否足够回答问题（True/False）
    sufficient: bool | None = None



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

    # 重排序得分。
    rerank_score: float | None = None



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
            retrieval_meta=_parse_retrieval_meta(citation.retrieval_meta),
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

class VerifyResultRead(BaseModel):
    """answer_verifier 校验结果，落库到 messages.extra_metadata.verify_result。

    - verified=True: 答案被引用片段支撑；reason 通常为空
    - verified=False: 触发拒答替换（service 层覆盖 answer/refused），reason 写入失败原因
    """

    # 校验是否通过（True 表示通过，False 表示未通过）
    verified: bool
    # 校验的原因/解释（可选，默认值为 None）
    reason: str | None = None


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
    # Agentic RAG 决策轨迹；user / 旧消息 / 关闭 agent loop 时为 None
    agent_steps: list[AgentStep] | None = None
    # 答案校验结果；user / 旧消息 / 关闭校验时为 None
    verify_result: VerifyResultRead | None = None
    # 用于追踪本次对话执行链路的 LangSmith 唯一标识符
    trace_id: str | None = None
    # 根据 trace_id 和后台配置拼接好的完整跳转链接
    trace_url: str | None = None

    # 定义类方法：将数据库的 Message ORM 对象转换为当前的 Pydantic 响应模型
    @classmethod
    def from_orm(cls, message) -> "MessageRead":  # type: ignore[no-untyped-def]

        # 提前判断当前消息是不是 AI 助手发出的
        is_assistant = message.role == "assistant"
        # ===== 处理 trace_id 字段 =====
        if is_assistant:
            trace_id = _parse_trace_id(message.extra_metadata)
        else:
            trace_id = None
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

        # ---------- 2. 处理 agent_steps 字段 ----------
        if is_assistant:
            # 如果是 AI 消息：去解析扩展元数据里的智能体决策轨迹
            agent_steps = _parse_agent_steps(message.extra_metadata)
        else:
            # 如果是用户消息：没有轨迹，给 None
            agent_steps = None

        # ---------- 3. 处理 verify_result 字段 ----------
        # 只有 assistant (AI) 发送的消息才可能存在“答案校验结果”
        if is_assistant:
            # 从消息的附加元数据(extra_metadata)中解析出 verify_result (校验结果对象)
            verify_result = _parse_verify_result(message.extra_metadata)
        else:
            # 如果是用户(user)发送的消息，则不存在校验结果，直接置为 None
            verify_result = None


        # 最后，把所有组装好的数据返回给 Pydantic 模型
        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            created_at=message.created_at,
            citations=citations,  # 传入上面计算好的引用列表
            query_route=query_route,# 传入上面计算好的路由信息
            agent_steps=agent_steps,
            verify_result=verify_result,
            trace_id=trace_id,
            trace_url=build_trace_url(trace_id),
        )


def _parse_verify_result(metadata: dict | None) -> VerifyResultRead | None:
    """从 messages.extra_metadata 中提取 verify_result 字段。第 8 章前的历史消息没有。"""
    # 1. 如果传入的 metadata 为空（None 或空字典），直接返回 None
    if not metadata:
        return None

    # 2. 尝试从 metadata 字典中获取 "verify_result" 对应的值
    raw = metadata.get("verify_result")

    # 3. 校验类型：如果取出的 raw 不是字典（比如是字符串、数字或 None），说明数据格式不对，返回 None
    if not isinstance(raw, dict):
        return None

    try:
        # 4. 使用 Pydantic 的 model_validate 将字典转换为 VerifyResultRead 模型实例
        # 如果字典内的字段类型不匹配（例如 verified 不是 bool），这里会抛出 ValidationError
        return VerifyResultRead.model_validate(raw)
    except Exception:
        # 5. 捕获所有校验异常，做最安全的降级处理：直接返回 None，防止整个接口因历史脏数据而崩溃
        return None

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


def _parse_trace_id(metadata: dict | None) -> str | None:
    """从 messages.extra_metadata 中提取 trace_id。"""
    # 1. 前置防御：如果传入的 metadata 为空（None 或空字典），直接返回 None
    if not metadata:
        return None

    # 2. 安全获取：使用 .get() 方法提取 trace_id。
    # 如果字典里没有这个 key，会默认返回 None，不会抛出 KeyError 异常
    raw = metadata.get("trace_id")

    # 3. 类型与有效性校验：
    # - isinstance(raw, str)：确保取出来的是字符串类型（防止存的是数字或对象）
    # - not raw.strip()：去掉首尾空格后，确保不是空字符串（防止存了 "   " 这种无效数据）
    # 任一条件不满足，都视为无效数据，返回 None
    if not isinstance(raw, str) or not raw.strip():
        return None

    # 4. 校验通过，返回干净的 trace_id 字符串
    return raw



# 会话详情的响应模型（包含会话基本信息以及该会话下的所有消息历史）
class ConversationDetail(BaseModel):
    """会话详情：会话本身 + 历史消息（含引用）。"""

    # 嵌套会话的基本信息模型
    conversation: ConversationRead
    # 嵌套该会话下的所有消息列表
    messages: list[MessageRead]


class RetrievalFilters(BaseModel):
    # 1. 限制文件类型：列表类型，最大允许传 20 个。
    # default_factory=list 保证每个实例拥有独立的空列表，防止内存共享污染。
    mime_types: list[str] = Field(default_factory=list, max_length=20)

    # 2. 文档创建时间范围限制（起始时间和结束时间），可选。
    created_from: datetime | None = None
    created_to: datetime | None = None

    # 3. 指定特定文档 ID 列表：最大允许传 200 个。
    document_ids: list[UUID] = Field(default_factory=list, max_length=200)

    # 【核心校验逻辑】：Pydantic V2 的模型验证器。
    # mode="after" 表示在所有字段都解析完毕之后，执行此方法进行跨字段的业务逻辑校验。
    @model_validator(mode="after")
    def validate_date_range(self):
        # 防呆设计：如果前端传了起始和结束时间，且“起始时间 > 结束时间”，直接抛出异常。
        # 阻止非法的时间范围进入底层数据库查询。
        if self.created_from and self.created_to and self.created_from > self.created_to:
            raise ValueError("created_from 不能晚于 created_to")
        return self  # 校验通过，必须返回 self

    # 【领域模型转换】：将 API 层的 Pydantic 模型，转换为领域层（Domain）的不可变对象。
    def to_domain(self) -> RetrievalFilter:
        # 为什么要把 list 转成 tuple？
        # 因为领域模型 RetrievalFilter 设置了 frozen=True（不可变），
        # list 在内部仍然可以被修改，转成 tuple 才能真正实现深度的“绝对只读”，保证并发安全。
        return RetrievalFilter(
            mime_types=tuple(self.mime_types),
            created_from=self.created_from,
            created_to=self.created_to,
            document_ids=tuple(self.document_ids),
        )


class ConversationListItem(BaseModel):
    """会话列表元素：侧栏渲染用，比 ConversationRead 多带 message_count。"""
    id: UUID
    title: str
    # 会话最后更新时间
    updated_at: datetime
    # 该会话包含的消息总数（用于侧边栏展示）
    message_count: int


class ConversationPage(BaseModel):
    """会话列表分页响应。统一 page/page_size 风格，与第 3 章文档列表一致。"""
    # 当前页的会话列表数据
    items: list[ConversationListItem]
    total: int
    page: int
    page_size: int



# 发起聊天提问的请求模型
class ChatRequest(BaseModel):
    # 用户提出的问题文本：最小长度为1（不能发空消息），最大长度限制为2000个字符（防止 token 超限或恶意刷屏）
    question: str = Field(min_length=1, max_length=2000)

    # 【高级功能】：本次提问可携带过滤条件。
    # 比如用户在前端勾选了“只搜索 PDF 文档”或者“只搜索上个月的文档”，就会传这个字段。
    # 类型为 RetrievalFilters 或 None（表示不限制检索范围）。
    filters: RetrievalFilters | None = None


# 定义工具函数：从扩展元数据（JSONB）中解析出 Agent 的历史步骤列表。
# 容错级别极高：只要数据缺失或格式非法，全部静默返回 None，绝不抛异常阻断业务。
def _parse_agent_steps(metadata: dict | None) -> list[AgentStep] | None:
    """从 messages.extra_metadata 解析 agent_steps；缺失 / 非法静默返回 None。"""

    # 1. 第一层防御：如果 metadata 字典本身为空（老数据或用户消息），直接返回 None。
    if not metadata:
        return None

    # 2. 从字典中提取出 agent_steps 对应的原始数据。
    raw = metadata.get("agent_steps")

    # 3. 第二层防御：检查提取出来的 raw 是不是列表，且不能是空列表。
    # 如果是字典、字符串、数字，或者是空列表 []，统统视为无效数据，返回 None。
    if not isinstance(raw, list) or not raw:
        return None

    # 4. 准备一个空列表，用于装载解析后强类型的 AgentStep 对象。
    parsed: list[AgentStep] = []

    # 5. 遍历列表中的每一个元素。
    for item in raw:
        # 6. 第三层防御：列表里的每个元素必须是一个字典，否则直接判定整体失败，返回 None。
        if not isinstance(item, dict):
            return None

        # 7. 第四层防御（最严苛的一环）：利用 Pydantic 进行强类型校验。
        try:
            # 尝试把字典转换成 AgentStep 对象。如果字典里缺少必填字段（如 action），或者字段类型不对，这里会抛出异常。
            parsed.append(AgentStep.model_validate(item))

        except Exception:
            # 8. 终极兜底：一旦 Pydantic 报错，直接把异常吞掉，返回 None。
            # 【业务考量】：历史记录展示只是辅助功能。如果某条老数据格式不兼容，大不了前端不展示时间轴面板，但绝不能因为这个报 500 错误，导致整个聊天记录加载不出来。
            return None

    # 9. 只有所有元素都完美通过了校验，才会走到这里，返回真正的强类型列表。
    return parsed