from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EvaluationStatusValue = Literal["running", "completed", "failed"]

# 与 app/evaluation/scoring.py 中 BadCaseCategory Literal 对齐
BadCaseCategoryValue = Literal[
    "document_parse_failed",
    "chunk_split_bad",
    "embedding_recall_miss",
    "keyword_recall_miss",
    "rrf_fusion_error",
    "rerank_order_error",
    "context_judge_too_loose",
    "context_judge_too_strict",
    "prompt_constraint_weak",
    "generation_off_context",
    "citation_parse_failed",
    "permission_filter_error",
    "other",
]


# =====================================================================
# 类作用：定义“创建评测任务”的请求体（前端发给后端的参数）。
# 只有最基础的必填信息，后端收到后会去加载数据集并生成完整任务。
# =====================================================================
class EvaluationRunCreate(BaseModel):
    """创建 run 的请求体。dataset_name 不带后缀（如 `seed`）。"""

    # 评测任务名称。限制长度 1~256，防止前端传空字符串或超长文本
    name: str = Field(min_length=1, max_length=256, description="便于回看的 run 名称")

    # 数据集名称。限制长度 1~128，前端传的时候不能带 .jsonl 后缀
    dataset_name: str = Field(min_length=1, max_length=128, description="评测集文件名（不带 .jsonl）")


# =====================================================================
# 类作用：定义“返回评测任务详情”的响应体（后端返回给前端的数据）。
# 包含了任务的完整状态、各项指标以及起止时间。
# =====================================================================
class EvaluationRunRead(BaseModel):
    # 【关键配置】允许从 ORM 对象（数据库模型）读取数据。
    # 这样你可以直接把数据库查出来的 EvaluationRun 对象丢给它，它会自动提取字段，不需要手动转字典。
    model_config = ConfigDict(from_attributes=True)

    # 评测任务的唯一 ID
    id: UUID
    # 任务名称
    name: str
    # 数据集名称
    dataset_name: str
    # 数据集总题数
    dataset_size: int
    # 任务状态（只能是在之前定义的 running/completed/failed 中选一个）
    status: EvaluationStatusValue

    # 进度统计
    progress_total: int
    progress_completed: int
    progress_failed: int

    # --- RAG 评测得分（跑完前为 None） ---
    # 忠实度
    faithfulness: float | None = None
    # 答案相关性
    answer_relevancy: float | None = None
    # 上下文精确率
    context_precision: float | None = None
    # 上下文召回率
    context_recall: float | None = None
    # 引用命中率
    citation_hit_rate: float | None = None
    # 拒答准确率
    refusal_accuracy: float | None = None

    # --- 性能延迟指标（跑完前为 None） ---
    # 平均总耗时
    avg_latency_ms: float | None = None
    # 平均首 Token 延迟
    avg_first_token_latency_ms: float | None = None

    # --- 异常与生命周期时间（跑完前为 None） ---
    # 错误信息
    error_message: str | None = None
    # 开始时间
    started_at: datetime | None = None
    # 结束时间
    finished_at: datetime | None = None
    # 创建时间（只要创建了对象，这个时间必定有值，所以不需要 None）
    created_at: datetime


# =====================================================================
# 类作用：评测任务（Run）列表中的单行数据模型。
# 用于在前端展示任务列表时，提供任务的基本信息、进度和最终的各项平均得分。
# =====================================================================
class EvaluationRunListItem(BaseModel):
    """列表元素：与 Read 一致字段，提取出来后续可裁字段也方便。"""

    # 允许从数据库 ORM 实体对象自动提取属性
    model_config = ConfigDict(from_attributes=True)

    # --- 基础信息 ---
    id: UUID
    name: str
    dataset_name: str
    dataset_size: int
    status: EvaluationStatusValue
    progress_total: int
    progress_completed: int
    progress_failed: int

    # --- 评分与延迟指标（未跑完或未算出时为 None） ---
    faithfulness: float | None = None
    answer_relevancy: float | None = None
    context_precision: float | None = None
    context_recall: float | None = None
    citation_hit_rate: float | None = None
    refusal_accuracy: float | None = None
    avg_latency_ms: float | None = None
    avg_first_token_latency_ms: float | None = None

    # 创建时间
    created_at: datetime


# =====================================================================
# 类作用：评测任务（Run）的分页响应模型。
# 这是一个通用的“外壳”，包裹了当前页的数据列表和分页元数据。
# =====================================================================
class EvaluationRunPage(BaseModel):
    # 当前页的评测任务列表
    items: list[EvaluationRunListItem]
    # 数据库中符合条件的数据总条数（用于前端计算总页数）
    total: int
    # 当前页码
    page: int
    # 每页大小
    page_size: int


# =====================================================================
# 类作用：单条评测明细（Case）的详情读取模型。
# 包含了该道题从“输入”到“输出”、再到“评分”及“归因”的完整快照。
# 常用于前端点击列表某一行，查看详细的问答和打分过程。
# =====================================================================
class EvaluationItemRead(BaseModel):
    """单条 case 的输入快照 + 实际输出 + 指标 + Bad Case 归因。"""

    # 允许从数据库 ORM 实体对象自动提取属性
    model_config = ConfigDict(from_attributes=True)

    # --- 基础关联信息 ---
    id: UUID
    run_id: UUID
    case_id: str

    # --- 输入快照（从评测集固化而来） ---
    question: str
    expected_answer: str
    # 使用 default_factory=list 确保每个实例都有独立的空列表，避免共享内存陷阱
    expected_document_names: list[str] = Field(default_factory=list)
    expected_keywords: list[str] = Field(default_factory=list)
    should_refuse: bool
    tags: list[str] = Field(default_factory=list)

    # --- 实际运行输出 ---
    actual_answer: str
    actual_refused: bool
    citations: list[dict] = Field(default_factory=list)
    retrieved_chunks_meta: list[dict] = Field(default_factory=list)
    query_route: dict | None = None
    agent_steps: list[dict] | None = None
    verify_result: dict | None = None
    trace_id: str | None = None

    # --- 性能与异常 ---
    latency_ms: int
    first_token_latency_ms: int | None = None
    error_message: str | None = None

    # --- RAGAS 评测指标（跑完且计算成功后才会有值） ---
    faithfulness: float | None = None
    answer_relevancy: float | None = None
    context_precision: float | None = None
    context_recall: float | None = None

    # --- 拒答与引用专项指标 ---
    citation_hit: bool | None = None
    refusal_correct: bool

    # --- Bad Case 人工/自动归因 ---
    is_bad_case: bool
    bad_case_category: BadCaseCategoryValue | None = None
    bad_case_note: str | None = None

    # 创建时间
    created_at: datetime


# =====================================================================
# 类作用：单条评测明细（Item）的分页响应模型。
# 同样是一个“外壳”，包裹了当前页的明细列表和分页元数据。
# =====================================================================
class EvaluationItemPage(BaseModel):
    # 当前页的明细列表
    items: list[EvaluationItemRead]
    # 总条数
    total: int
    # 当前页码
    page: int
    # 每页大小
    page_size: int


# =====================================================================
# 类作用：前端人工覆盖/修改 Bad Case 归因的请求体。
# 常用于前端页面用户手动修正系统误判的错题。
# =====================================================================
class EvaluationItemUpdate(BaseModel):
    """前端覆盖 Bad Case 归因。

    传 `is_bad_case=null` 时保持原值；显式传 `is_bad_case=false` 可手动把
    误判的 case 标回“非 Bad Case”。
    """

    # 错误分类枚举值，前端可传具体的错误类型（如 "generation_off_context"）
    bad_case_category: BadCaseCategoryValue | None = None

    # 人工填写的备注信息，解释为什么把它判定为或取消判定为 Bad Case
    bad_case_note: str | None = None

    # 核心状态：是否标记为 Bad Case。
    # 默认 None 代表不修改；传 True 代表标为错题；传 False 代表取消错题标记
    is_bad_case: bool | None = None


# =====================================================================
# 类作用：单个数据集的基础信息模型。
# 用于前端下拉列表选择评测集时展示。
# =====================================================================
class DatasetInfo(BaseModel):
    # 数据集名称（不带 .jsonl 后缀）
    name: str

    # 数据集包含的样本数量
    size: int


# =====================================================================
# 类作用：数据集列表的响应体模型。
# 包裹一个由 DatasetInfo 组成的列表，统一返回给前端。
# =====================================================================
class DatasetListResponse(BaseModel):
    # 数据集信息列表
    items: list[DatasetInfo]