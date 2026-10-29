from typing import Literal, TypedDict
from uuid import UUID

from app.db.models import Message
from app.retrieval.filters import RetrievalFilter
from app.retrieval.vector_retriever import RetrievedChunk

QueryRoute = Literal["original", "rewrite", "hyde", "multi_query", "rewrite_multi_query"]

# 定义 RAG 流程的状态字典（State）
# 继承自 TypedDict，用于在 LangGraph 等工作流框架中传递各个节点的数据。
# total=False 表示这个字典里的所有键都是可选的（不是每个阶段都同时存在所有字段）。
class RAGState(TypedDict, total=False):
    # ==================== 输入阶段 ====================

    # 当前对话的会话 ID
    conversation_id: UUID
    # 用户当前提出的问题
    question: str

    # ==================== load_context 节点产出 ====================

    # 从数据库中加载出来的历史对话记录（用于多轮对话的上下文记忆）
    chat_history: list[Message]

    # ==================== normalize_query 节点产出 ====================

    # 规范化/改写后的查询语句（例如：解决代词指代、补全省略信息），
    query: str

    # route_query 产出
    # route: 实际采用的策略；query: 覆盖 normalize_query 的透传 query（rewrite/hyde 路径下变成改写文本）
    route: QueryRoute
    rewritten_query: str | None
    hyde_answer: str | None
    multi_queries: list[str] | None

    # ==================== retrieve 节点产出 ====================

    # 通过向量检索召回的、与用户问题相关的文本块列表
    retrieved_chunks: list[RetrievedChunk]

    # 是否触发拒答（检索不足）。如果为 True，则直接跳过后续的 generate 生成节点，直接走拒答逻辑。
    refused: bool

    # ====== Agentic RAG 循环相关的状态字段 ======
    # 这些字段被定义在 RAGState（或类似的状态机）中，用于驱动和控制智能体的多轮检索循环。

    # 1. 智能体思考与行动的完整轨迹记录。
    # 这是一个列表，列表中的每一项是一个字典，记录了智能体在某一轮的“决策”和“观察结果”。
    # 字典的典型结构包含：
    #   round: 当前是第几轮检索
    #   action: 采取的动作（如"检索"、"直接回答"、"结束"）
    #   reason: LLM 做出该决策的原因（推理过程）
    #   route: 采用的检索策略（向量/关键词/混合）
    #   query: 实际使用的检索词
    #   retrieved_count: 本轮召回的文本块数量
    #   top_score: 本轮召回的最高得分
    #   sufficient: 本轮检索到的信息是否足以回答用户问题
    # 这样设计是为了将“决策（plan）”和“结果（observe）”合并记录在同一个步骤中，方便前端完整回溯 Agent 的思考链路。
    # 由 plan_retrieval 追加"决策"字段、observe_context 回填"观察"字段，避免分两条记录
    agent_steps: list[dict]

    # 2. 当前检索轮次（计数器）。
    # 每循环一次（如触发一次 plan -> retrieve -> observe），该数字递增。
    # 主要用来和配置项 agent_max_rounds（最大轮次）做比对，防止 Agent 陷入无限死循环，保护大模型 Token 和 API 费用。
    retrieval_round: int

    # 3. 上下文充足性判定标记（循环退出条件）。
    # 由 observe_context 节点产出。它会基于检索结果来评估：“当前找到的内容，够不够回答用户的问题？”
    # - 如果为 True：说明信息已经足够，工作流图（Graph）会直接走向 rerank 节点，跳出循环，开始生成最终回答。
    # - 如果为 False：说明信息不足，工作流会走回 plan_retrieval 节点，让 LLM 重新改写查询词，进行下一轮检索。
    context_sufficient: bool

    # rerank 后基于 Top1 score 的拒答闸门
    # False 时图走向 refuse 节点；True 时图走向 END
    context_is_enough: bool

    # ==================== generate 节点产出 ====================

    # 大模型基于检索到的上下文和历史对话生成的最终回答
    answer: str

    # ==================== chat_service 落库后回写 ====================

    # 用户消息存入数据库后生成的 UUID
    user_message_id: UUID
    # 助手回复存入数据库后生成的 UUID
    assistant_message_id: UUID

    # LangSmith trace_id: 未启用观测 / 取不到 run tree 时为 None
    # 仅由 service 层 stream_answer 进入 @traceable 上下文后写入，节点不感知
    trace_id: str | None

    # ==================== 条件过滤查询 ====================
    filters: RetrievalFilter | None