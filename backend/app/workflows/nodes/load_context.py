from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.db.repositories.conversation_repo import ConversationRepository
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：加载历史对话上下文
# 接收当前的 RAG 状态字典 state，以及数据库会话 session，返回更新后的状态字典
async def load_context(state: RAGState, session: AsyncSession) -> RAGState:
    # 实例化对话仓储类，用于执行数据库查询
    repo = ConversationRepository(session)

    # 多轮窗口按消息条数截取
    # 调用仓储方法获取最近的几条消息。
    # 参数 1：从 state 字典中取出当前会话的 conversation_id。
    # 参数 2：limit 限制。注意这里的 `settings.chat_history_window * 2`：
    # chat_history_window 配置的是“对话轮数”（比如 5 轮）。
    # 1 轮对话包含 2 条消息（1 条 User 提问 + 1 条 AI 回复），所以要乘以 2 转换成真实的消息条数。
    history = await repo.recent_messages(
        state["conversation_id"], limit=settings.chat_history_window * 2
    )

    # 返回一个字典，这会被 LangGraph 合并到全局的 RAGState 中。
    # 将查出来的历史消息列表赋值给 "chat_history" 这个键，供后续组装 Prompt 使用。
    return {"chat_history": history}