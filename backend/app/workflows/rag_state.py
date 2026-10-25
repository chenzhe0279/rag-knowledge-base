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

    # ==================== generate 节点产出 ====================

    # 大模型基于检索到的上下文和历史对话生成的最终回答
    answer: str

    # ==================== chat_service 落库后回写 ====================

    # 用户消息存入数据库后生成的 UUID
    user_message_id: UUID
    # 助手回复存入数据库后生成的 UUID
    assistant_message_id: UUID

    # ==================== 条件过滤查询 ====================
    filters: RetrievalFilter | None