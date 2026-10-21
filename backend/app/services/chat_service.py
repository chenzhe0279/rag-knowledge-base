from sqlalchemy.ext.asyncio import AsyncSession
from app.core.logger import get_logger
from app.retrieval.vector_retriever import RetrievedChunk
from uuid import UUID
from app.core.exceptions import NotFoundError
from app.db.repositories.conversation_repo import ConversationRepository
from collections.abc import AsyncIterator
from app.db.models import AnswerCitation, Conversation, Message
from app.db.repositories.citation_repo import AnswerCitationRepository
from app.db.session import AsyncSessionLocal
from app.workflows.nodes import (
    load_context,
    normalize_query,
    retrieve,
    stream_generate,
)
from app.workflows.rag_state import RAGState
# 获取当前模块的日志记录器，用于打印该文件产生的运行日志
logger = get_logger(__name__)


# 定义内部函数：将检索到的文本块对象序列化为字典格式，用于通过 SSE 推送给前端
def _serialize_citation(chunk: RetrievedChunk, ordinal: int) -> dict:
    """citations SSE 事件载荷格式（与前端约定一致）。

    ordinal 必须显式传入：与 prompt 中给 LLM 看到的「片段 N」编号一致，
    前端按这个数字渲染 [N] 角标，避免后续顺序丢失导致引用串号。
    """
    # 构造并返回一个字典，包含前端渲染引用角标和弹窗所需的所有信息
    return {
        # 引用序号（对应大模型回答中的 [N]），由外部显式传入以保证一致性
        "ordinal": ordinal,
        # 文本块唯一 ID，转为字符串以适配 JSON 序列化
        "chunk_id": str(chunk.chunk_id),
        # 所属文档唯一 ID，同样转为字符串
        "document_id": str(chunk.document_id),
        # 文档的名称（如：员工手册.pdf）
        "document_name": chunk.document_name,
        # 文本块所在的页码（可能为 None）
        "page_no": chunk.page_no,
        # 文本块所在的章节路径（可能为 None）
        "section_path": chunk.section_path,
        # 语义相似度得分，使用 round 保留 4 位小数，减少网络传输体积
        "score": round(chunk.score, 4),
        # 引用的具体原文内容，供前端悬浮展示
        "quote": chunk.content,
    }


# 定义聊天服务类，封装与对话相关的核心业务逻辑
class ChatService:
    """注意：

    - 非流式接口（创建会话 / 历史）使用 FastAPI 注入的请求级 session
    - 流式问答使用独立 session（与请求生命周期解耦），由 stream_answer 内部管理
    """

    # 构造函数：接收数据库会话实例
    def __init__(self, session: AsyncSession) -> None:
        # 将 session 保存在实例属性中，供类里的其他方法使用
        self.session = session


    # 定义异步方法：创建一个新的对话
    async def create_conversation(self, title: str = "新对话") -> Conversation:
        # 实例化对话仓储层，复用当前服务的数据库 session
        repo = ConversationRepository(self.session)
        # 调用仓储层方法执行创建逻辑（内部会 flush，生成 UUID 等数据库默认值）
        conversation = await repo.create(title=title)
        # 提交数据库事务，将新对话真正持久化
        await self.session.commit()
        # 刷新对象状态，确保获取到数据库自动生成的最终字段（如创建时间）
        await self.session.refresh(conversation)
        # 返回创建好的对话对象
        return conversation

    # 定义异步方法：根据 ID 获取一个对话
    async def get_conversation(self, conversation_id: UUID) -> Conversation:
        # 实例化对话仓储层
        repo = ConversationRepository(self.session)
        # 根据对话 ID 去数据库查询
        conversation = await repo.get(conversation_id)
        # 防御性校验：如果数据库里没有这条记录
        if conversation is None:
            # 抛出业务异常（404），由全局异常处理器捕获并返回给前端
            raise NotFoundError("会话不存在")
        # 如果存在，返回查询到的对话对象
        return conversation

    # 定义异步方法：获取指定对话的详情以及其包含的所有历史消息
    async def list_messages(
            self, conversation_id: UUID
    ) -> tuple[Conversation, list[Message]]:
        # 先校验会话存在，避免“空会话”和“会话不存在”被混淆
        # 直接调用上面的 get_conversation 方法。如果会话不存在，会在这里直接抛 404 异常中断
        conversation = await self.get_conversation(conversation_id)

        # 实例化对话仓储层
        repo = ConversationRepository(self.session)
        # 查询该会话下的所有历史消息记录（仓储层内部已按时间正序排列）
        messages = await repo.list_messages(conversation_id)

        # 返回一个元组，包含“对话实体信息”和“消息列表”
        return conversation, messages



    # 定义异步生成器方法：处理流式问答，逐个事件（Event）向前端 yield SSE（Server-Sent Events）数据
    async def stream_answer(self, conversation_id: UUID, question: str) -> AsyncIterator[dict]:
        """逐事件 yield SSE 载荷。

        事件协议（与前端约定）：
            message_start -> citations -> token... -> message_end
        任何阶段出错则改 yield error 并提前结束。
        """

        # 校验会话存在用 service 自带 session；流式跑用独立 session
        # 前置校验：检查会话是否存在。如果不存在，这里会直接抛出 404 异常，阻断后续流式输出。
        await self.get_conversation(conversation_id)

        # 【核心】开启一个独立的数据库会话（Session）。
        # 因为流式响应可能持续几十秒甚至几分钟，不能一直占用 FastAPI 请求级别的短连接，否则会导致数据库连接池耗尽。
        async with AsyncSessionLocal() as session:
            # 开启异常捕获，确保任何报错都能优雅地以 SSE 格式通知前端，而不是直接断开连接
            try:
                # 初始化 RAG 状态机（State），用于在各个处理节点之间传递数据
                state: RAGState = {
                    # 存入会话 ID
                    "conversation_id": conversation_id,
                    # 存入用户当前问题
                    "question": question,
                }

                # 1. 加载上下文（仅历史消息，本轮 user 此刻尚未入库）+ 改写查询
                # 调用 load_context 节点，从数据库拉取历史对话记录，并更新到 state 中
                state.update(await load_context(state, session))
                # 调用 normalize_query 节点，对用户问题进行规范化/改写，并更新到 state 中
                state.update(await normalize_query(state))

                # 2. user 消息落库
                # 将用户本次的提问保存到数据库（独立提交），拿到 user_message_id，防止后续生成失败丢失用户提问
                await self._persist_user_message(state, session)

                # 发送第一个 SSE 事件：通知前端对话已开始，并回传用户消息的数据库 ID
                yield {
                    "event": "message_start",
                    "data": {"user_message_id": str(state["user_message_id"])},
                }

                # 3. retrieve（含拒答判定）-> 先把引用发给前端，让参考资料面板立刻可见
                # 调用 retrieve 节点，去向量数据库检索相关文本块，并判断是否需要拒答
                state.update(await retrieve(state, session))

                #  先获取检索到的文本块列表，如果 state 里没有，默认给个空列表 [] 防止报错
                retrieved_chunks = state.get("retrieved_chunks", [])

                #  创建一个空列表，准备装序列化后的引用数据
                citations_payload = []

                #  使用 enumerate 遍历列表。
                # start=1 表示序号 i 从 1 开始（必须与 Prompt 里大模型看到的 [1]、[2] 严格对应）
                for i, c in enumerate(retrieved_chunks, start=1):
                    # 4. 调用 _serialize_citation 函数。
                    # 传入当前的文本块 c，以及对应的序号 i
                    serialized_item = _serialize_citation(c, ordinal=i)

                    # 5. 将处理好的字典追加到结果列表中
                    citations_payload.append(serialized_item)

                # 发送第二个 SSE 事件：将引用列表（citations）推送给前端，让用户在AI回答前就能看到参考依据
                yield {
                    "event": "citations",
                    "data": {"citations": citations_payload},
                }

                # 4. 生成：拒答直接走拒答文案；否则逐 token 流式
                # 检查 state 中的 refused 标记，如果为 True 说明检索质量太差，触发了拒答机制
                if state.get("refused"):
                    # 如果是拒答，直接把 state 里预存好的拒答文案（REFUSAL_ANSWER）作为 token 推给前端
                    yield {
                        "event": "token",
                        "data": {"delta": state["answer"]},
                    }
                # 如果没有拒答，则正常调用大模型进行流式生成
                else:
                    # 创建一个列表，用于在流式生成的同时，把所有的文本片段拼接起来，以便最终落库
                    answer_parts: list[str] = []
                    # 异步遍历 stream_generate 节点，它每次会吐出大模型生成的一小段文本（delta）
                    async for delta in stream_generate(state):
                        # 把这一段文本加到缓存列表中
                        answer_parts.append(delta)
                        # 发送第三个（以及后续无数个） SSE 事件：把当前生成的文本片段推给前端，实现打字机效果
                        yield {"event": "token", "data": {"delta": delta}}
                    # 流式生成结束后，把所有片段拼接成完整的回答，存回 state 中
                    state["answer"] = "".join(answer_parts)

                # 5. assistant 消息 + citations 同事务落库（保证两者原子）
                # 将 AI 的完整回答以及引用记录，在同一个数据库事务中保存下来，防止产生“有回答无引用”的脏数据
                await self._persist_assistant_message(state, session)

                # 发送最后一个 SSE 事件：通知前端对话生成已完全结束，并回传助手消息的 ID 和是否拒答的状态
                yield {
                    "event": "message_end",
                    "data": {
                        "message_id": str(state["assistant_message_id"]),
                        "refused": bool(state.get("refused")),
                    },
                }

            # 捕获整个流程中可能出现的任何异常
            except Exception as exc:
                # 记录完整的异常堆栈到后端日志，方便排查
                logger.exception("chat stream failed: conversation_id=%s", conversation_id)
                # 注意：user 消息可能已在前面独立 commit，这里只回滚未提交的部分
                # （比如 assistant 写入中途失败）。保留 user 消息便于前端排查 / 重试。
                # 回滚当前数据库会话中的未提交事务，避免脏数据残留
                await session.rollback()
                # 发送错误 SSE 事件：将错误信息格式化后推给前端
                yield {
                    "event": "error",
                    "data": {
                        # 错误码，供前端判断
                        "code": "chat_stream_failed",
                        # 错误信息。使用 strip() 去除首尾空白，如果是空字符串则使用默认的兜底提示
                        "message": str(exc).strip() or "问答处理失败",
                    },
                }


    # 定义内部异步方法：持久化用户消息
    async def _persist_user_message(self, state: RAGState, session: AsyncSession) -> None:
        """流式开始前先把 user 消息落库并 commit。

        必须在 load_context 之后调用：load_context 读到的"历史消息"不应包含本轮提问。
        """
        # 实例化对话仓储类，复用传入的独立数据库会话
        repo = ConversationRepository(session)

        # 调用静态工厂方法，快速构建一个用户角色的 Message 实体对象。
        # 从 state 中取出当前会话 ID 和用户的问题。
        user_msg = ConversationRepository.make_user_message(
            state["conversation_id"], content=state["question"]
        )

        # 将构建好的用户消息对象添加到数据库会话中（底层会执行 flush 生成主键）
        await repo.add_messages([user_msg])

        # 【关键步骤】：立刻提交事务！
        # 为什么要提前提交？因为后续的大模型流式生成可能会耗时很长，甚至中途报错断开。
        # 提前把用户的提问落库，可以保证即使后续 AI 生成失败，用户的输入记录依然存在，方便前端排查或重试。
        await session.commit()

        # 将数据库生成的用户消息主键 ID 回写到 state 字典中，
        # 这样在外层的 stream_answer 就能拿到这个 ID，并通过 SSE 的 message_start 事件推给前端。
        state["user_message_id"] = user_msg.id

    # 定义内部异步方法：持久化助手（AI）消息及其引用
    async def _persist_assistant_message(self, state: RAGState, session: AsyncSession) -> None:
        """流式生成结束后落库 assistant 消息及其引用，单事务保证两者原子。"""
        # 实例化对话仓储和引用仓储，复用同一个数据库会话
        conv_repo = ConversationRepository(session)
        citation_repo = AnswerCitationRepository(session)

        # 调用静态工厂方法，构建一个 AI 角色的 Message 实体对象。
        assistant_msg = ConversationRepository.make_assistant_message(
            # 当前会话 ID
            state["conversation_id"],
            # 大模型生成的完整回答
            content=state["answer"],
            # 附加元数据：将是否拒答的状态（True/False）存进 JSONB 字段里，方便日后统计分析
            extra_metadata={"refused": bool(state.get("refused"))},
        )
        # 将 AI 消息实体添加到会话中（生成主键）
        await conv_repo.add_messages([assistant_msg])

        # 如果没有触发拒答逻辑（即正常回答了问题），则需要保存引用记录
        if not state.get("refused"):
            # 1. 先创建一个空列表，准备装所有的引用实体对象
            citations = []

            # 2. 从 state 中取出检索到的文本块列表（如果没取到，默认给个空列表 [] 兜底）
            retrieved_chunks = state.get("retrieved_chunks", [])

            # 3. 使用 enumerate 遍历列表。
            # start=1 表示序号从 1 开始（对应给大模型看的 [1]、[2] 编号）。
            # ordinal 是序号，chunk 是当前的文本块对象。
            for ordinal, chunk in enumerate(retrieved_chunks, start=1):
                # 4. 用当前的序号和文本块信息，实例化一个 AnswerCitation 对象
                citation = AnswerCitation(
                    # 关联当前刚刚生成的 AI 消息 ID
                    message_id=assistant_msg.id,
                    # 引用序号
                    ordinal=ordinal,
                    # 源文档 ID
                    document_id=chunk.document_id,
                    # 源文本块 ID
                    chunk_id=chunk.chunk_id,
                    # 冗余快照：文档名
                    document_name=chunk.document_name,
                    # 页码
                    page_no=chunk.page_no,
                    # 冗余快照：引用的原文内容
                    quote=chunk.content,
                )

                # 5. 将实例化好的对象追加到列表中
                citations.append(citation)
            # 将引用列表批量添加到会话中
            await citation_repo.bulk_add(citations)

        # 【最终提交】：统一提交事务。
        # 因为使用的是同一个 session，AI 消息（assistant_msg）和引用记录（citations）会在同一个事务中一起提交。
        # 这就保证了原子性：要么都存成功，要么都失败回滚，绝不会出现“有回答却找不到引用”的尴尬情况。
        await session.commit()

        # 将数据库生成的 AI 消息主键 ID 回写到 state 中，供外层的 message_end 事件使用
        state["assistant_message_id"] = assistant_msg.id