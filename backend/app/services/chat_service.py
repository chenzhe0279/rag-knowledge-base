from app.core.tracing import traceable
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.logger import get_logger
from app.core.observability import get_current_trace_id, build_trace_url
from app.llm.answer_verifier import VerifyResult, get_answer_verifier
from app.llm.prompts import REFUSAL_ANSWER
from app.retrieval.filters import RetrievalFilter
from app.retrieval.vector_retriever import RetrievedChunk
from uuid import UUID
from app.core.exceptions import NotFoundError
from app.db.repositories.conversation_repo import ConversationRepository
from collections.abc import AsyncIterator
from app.db.models import AnswerCitation, Conversation, Message
from app.db.repositories.citation_repo import AnswerCitationRepository
from app.db.session import AsyncSessionLocal
from app.workflows.graph import get_rag_graph
from app.workflows.nodes import (
    load_context,
    normalize_query,
    retrieve,
    route_query,
    stream_generate,
)
from app.workflows.rag_state import RAGState
# 获取当前模块的日志记录器，用于打印该文件产生的运行日志
logger = get_logger(__name__)
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
    @traceable(name="ChatService.stream_answer", run_type="chain")
    async def stream_answer(self, conversation_id: UUID, question: str,  filters: RetrievalFilter | None = None,) -> AsyncIterator[dict]:
        """逐事件 yield SSE 载荷。
           事件协议（与前端约定）：
           message_start -> query_route -> agent_steps -> citations -> token...
           -> [verify_result] -> message_end
           - 拒答路径不发 verify_result（拒答本身已经是终态）
           - verify_result.verified=False 时携带 replacement_answer，前端按它整段
          替换流式出来的答案，与 PRD"校验失败 -> 拒答替换"对齐
           - 任何阶段出错则改 yield error 并提前结束。
        """

        # 校验会话存在用 service 自带 session；流式跑用独立 session
        # 前置校验：检查会话是否存在。如果不存在，这里会直接抛出 404 异常，阻断后续流式输出。
        await self.get_conversation(conversation_id)
        # 【核心】开启一个独立的数据库会话（Session）。
        # 因为流式响应可能持续几十秒甚至几分钟，不能一直占用 FastAPI 请求级别的短连接，否则会导致数据库连接池耗尽。
        async with AsyncSessionLocal() as session:
            # 开启异常捕获，确保任何报错都能优雅地以 SSE 格式通知前端，而不是直接断开连接
            try:
                # 取 LangSmith trace_id: @traceable 已经为本次 stream_answer 建好 root run,
                # 这里读到的就是整次问答的 trace_id; 未启用观测时返回 None
                # get_current_trace_id()必须在进入 @traceable 上下文之内调用，所以放在stream_answer函数体里。
                trace_id = get_current_trace_id()
                # 初始化 RAG 状态机（State），用于在各个处理节点之间传递数据
                state: RAGState = {
                    # 存入会话 ID
                    "conversation_id": conversation_id,
                    # 存入用户当前问题
                    "question": question,
                    # 存入 trace_id
                    "trace_id": trace_id,
                    # 存入检索过滤器
                    "filters": filters,
                }

                # 1. 加载上下文（仅历史消息，本轮 user 此刻尚未入库）+ 改写查询 + 路由
                # 调用 load_context 节点，从数据库拉取历史对话记录，并更新到 state 中
                state.update(await load_context(state, session))

                # 2. 跑 RAG 子图: normalize_query ->  route_query -> 检索决策循环
                final_state = await get_rag_graph().ainvoke(state)
                state.update(final_state) # type = ignore[arg-type]

                # 3. user 消息落库
                # 将用户本次的提问保存到数据库（独立提交），拿到 user_message_id，防止后续生成失败丢失用户提问
                await self._persist_user_message(state, session)

                # 发送第一个 SSE 事件：通知前端对话已开始，并回传用户消息的数据库 ID
                yield {
                    "event": "message_start",
                    "data": {
                        "user_message_id": str(state["user_message_id"]),
                        "trace_id": trace_id,
                        "trace_url": build_trace_url(trace_id),
                    },
                }

                # 把query 路由结果推给前端调试面板(始终发送，前端按route选择渲染)
                yield {
                    "event": "query_route",
                    "data": _build_query_route_payload(state),
                }
                # 调用 _serialize_agent_steps 函数，把 agent_steps 列表序列化为标准格式并推送给前端
                yield {
                    "event": "agent_steps",
                    "data": {
                        "steps": _serialize_agent_steps(state)
                    },
                }
                # 3. retrieve（含拒答判定）-> 先把引用发给前端，让参考资料面板立刻可见
                # 调用 retrieve 节点，去向量数据库检索相关文本块，并判断是否需要拒答
                state.update(await retrieve(state))

                # 1. 先准备一个空列表，用于存放最终结果
                citations_payload = []

                # 2. 判断系统是否触发了“拒答（refused）”
                if state.get("refused"):
                    # 情况 A：触发了拒答（说明系统认为检索到的内容完全不够或质量太差）
                    # 即使 agent 循环中途某一轮搜到了东西，我们也坚决不给前端展示这些参考资料。
                    # 所以这里直接让它保持空列表 [] 即可，什么都不做。
                    pass
                else:
                    # 情况 B：系统正常回答，需要把检索到的文本块打包成引用列表
                    # 从 state 里安全取出检索到的文本块列表，如果没有则给个空列表兜底
                    chunks = state.get("retrieved_chunks", [])

                    # 使用 enumerate 遍历，start=1 表示序号从 1 开始（对应大模型回答里的 [1]、[2]）
                    for i, c in enumerate(chunks, start=1):
                        # 调用序列化函数，把文本块转为前端需要的格式，并传入序号 i
                        item = _serialize_citation(c, ordinal=i)

                        # 将打包好的引用对象塞进结果列表
                        citations_payload.append(item)

                # 发送第二个 SSE 事件：将引用列表（citations）推送给前端，让用户在AI回答前就能看到参考依据
                yield {
                    "event": "citations",
                    "data": {"citations": citations_payload},
                }

                # 4. 生成：拒答直接走拒答文案；否则逐 token 流式
                # 检查 state 中的 refused 标记，如果为 True 说明检索质量太差，触发了拒答机制
                verify_result: VerifyResult | None = None
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
                    # 6. 答案校验，verify 失败替换为拒答文案
                    if settings.verify_answer_enabled:
                        # 调用校验器（异步），传入用户问题、模型生成的答案以及检索到的上下文块
                        verify_result = await get_answer_verifier().verify(
                            question=state["query"],
                            answer=state["answer"],
                            # 从 state 中获取 retrieved_chunks，如果没有则返回空列表
                            chunks=list(state.get("retrieved_chunks", [])),
                        )
                        replacement = (
                            REFUSAL_ANSWER if not verify_result.verified else None
                        )
                        # 如果校验失败（verified=False），则将替换文案设为预定义的拒答文案；如果校验通过则为 None
                        if not verify_result.verified:
                            state["answer"] = REFUSAL_ANSWER
                            state["refused"] = True
                        # 向前端 yield（发送）一个 SSE 事件，告知前端校验结果
                        yield {
                            "event": "verify_result",
                            # 调用之前定义的 _build_verify_payload 构建载荷
                            # 注意：只有 verified=False 时，replacement 才会有值并被打包进去
                            "data": _build_verify_payload(
                                verify_result, replacement_answer=replacement
                            ),
                        }

                # 7. assistant 消息 + citations 同事务落库（保证两者原子）
                # 无论校验是否通过，都需要将最终的 assistant 消息（可能是替换后的拒答文案）持久化到数据库
                await self._persist_assistant_message(
                    state, session, verify_result=verify_result
                )

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
        """流式开始前先把 user 消息落库并 commit。首次提问时顺手把会话标题改成用户问题前 30 个字。

        必须在 load_context 之后调用：load_context 读到的"历史消息"不应包含本轮提问。
        标题更新放在同一事物里，避免新建会话后侧栏一直显示【新对话】
        """
        # 实例化对话仓储类，复用传入的独立数据库会话
        repo = ConversationRepository(session)

        #首次提问时（会话还没有任何消息）-> 把默认标题改成本次问题
        if await repo.count_messages(state["conversation_id"]) == 0:
            await repo.update_title_if_default(
                state["conversation_id"], title=state["question"]
            )

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
    async def _persist_assistant_message(self, state: RAGState, session: AsyncSession, *, verify_result: VerifyResult | None) -> None:
        """流式生成结束后落库 assistant 消息及其引用，单事务保证两者原子。"""
        # 实例化对话仓储和引用仓储，复用同一个数据库会话
        conv_repo = ConversationRepository(session)
        citation_repo = AnswerCitationRepository(session)

        # 初始化要附加的元数据字典
        extra_metadata: dict = {
            # 将 state 中的 refused 状态强转为布尔值并记录
            "refused": bool(state.get("refused")),
            # 构建并记录查询路由信息（调用外部辅助函数）
            "query_route": _build_query_route_payload(state),
            # 序列化并记录 Agent 的步骤信息（调用外部辅助函数）
            "agent_steps": _serialize_agent_steps(state),
            # LangSmith trace_id 落库，刷新历史时前端仍可展示 / 跳转
            "trace_id": state.get("trace_id"),
            # 将当前 RAG 状态中的过滤条件序列化为 JSON 字典，并赋值给外层字典的 "retrieval_filters" 键。
            "retrieval_filters": _build_filter_payload(state.get("filters")),
        }

        # 如果存在校验结果（即走过了校验流程）
        if verify_result is not None:
            # verify_result 复用 SSE 载荷格式，但 metadata 不需要 replacement_answer
            # 因此这里显式传入 replacement_answer=None，只保留 verified 和 reason 状态
            extra_metadata["verify_result"] = _build_verify_payload(
                verify_result, replacement_answer=None
            )

        # 调用 ConversationRepository 的静态工厂方法，构建一条 AI（助手）角色的消息实体。
        # 该方法会在内部自动补全角色的枚举值（MessageRole.ASSISTANT），并设置相关的默认字段。
        assistant_msg = ConversationRepository.make_assistant_message(
            # 从全局状态字典中取出当前对话的 ID
            state["conversation_id"],

            # 从状态字典中取出大模型生成的完整回答文本，作为消息的正文
            content=state["answer"],

            # 【核心设计】：构建 JSONB 格式的扩展元数据 (extra_metadata)。
            extra_metadata=extra_metadata
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
                    # 混合检索的元数据，供前端调试面板展示
                    retrieval_meta=_build_retrieval_meta(chunk),
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

    async def list_conversations(self, page: int, page_size: int) -> tuple[list[tuple[Conversation, int]], int]:
        """获取会话分页列表。"""
        # 实例化底层的数据访问对象（Repository），将当前的数据库 session 传进去
        repo = ConversationRepository(self.session)
        # 直接调用 Repository 中的 list_page 方法，处理分页逻辑并返回结果
        # 这里的逻辑（LEFT JOIN 等）在你之前提问的 list_page 函数中
        return await repo.list_page(page=page, page_size=page_size)


    async def delete_conversation(self, conversation_id: UUID) -> None:
        """删除指定会话。"""
        # 同样，实例化 Repository
        repo = ConversationRepository(self.session)
        # 尝试执行删除操作，返回一个布尔值表示是否真的删除了数据
        deleted = await repo.delete(conversation_id)

        # 如果 deleted 为 False，说明数据库里没找到这个会话
        if not deleted:
            # 抛出业务异常，通常会在 Web 框架（如 FastAPI）的路由层被捕获，并返回 404 状态码
            raise NotFoundError("会话不存在")

        # 如果删除成功，提交数据库事务（真正写入数据库）
        await self.session.commit()



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
        # 混合检索的元数据，供前端调试面板展示
        "retrieval_meta": _build_retrieval_meta(chunk),
    }


# 定义函数：用于构建查询路由（query_route）的数据载荷（Payload）
# 接收当前的 RAG 全局状态字典 state，返回一个用于传输的字典
def _build_query_route_payload(state: RAGState) -> dict:
    """SSE / metadata 共用的 query_route 载荷格式。

    始终携带 4 个可选字段（None 也保留），前端可据此判断展示哪种调试面板。
    """
    # 构造并返回一个包含所有路由相关信息的字典
    return {
        # 1. 最终使用的路由策略。使用 .get 提供默认值 "original"，防止极端情况下 state 里没这个键导致 KeyError 报错。
        "route": state.get("route", "original"),

        # 2. 实际用于向量检索的最终查询文本。同样提供空字符串 "" 作为默认兜底。
        "query": state.get("query", ""),

        # 3. 改写后的查询文本。如果没走 rewrite 策略，这里就是 None。
        "rewritten_query": state.get("rewritten_query"),

        # 4. HyDE 策略生成的假设性答案。如果没走 hyde 策略，这里就是 None。
        "hyde_answer": state.get("hyde_answer"),

        # 5. 多路查询生成的子查询列表。如果没走 multi_queries 策略，这里就是 None。
        "multi_queries": state.get("multi_queries"),
    }


def _build_retrieval_meta(chunk: RetrievedChunk) -> dict:
    """混合检索调试元数据"""
    # 返回一个字典，包含这条引用是“怎么被搜出来的”所有证据
    return {
        # 1. 来源渠道：记录它是被向量召回、关键词召回，还是双路都召回了。
        # 注意：chunk.sources 原本是个 tuple（元组），这里用 list() 转成列表。
        "sources": list(chunk.sources),

        # 2. 向量检索排名（如 1, 2, 3），如果没走向量检索，这里就是 None。
        "vector_rank": chunk.vector_rank,

        # 3. 向量原始得分（余弦相似度）。
        # 使用三元表达式进行空值保护：如果不为 None，就保留 4 位小数；如果是 None，就原样返回 None。
        # 为什么要 round(..., 4)？因为浮点数可能会产生 0.849999999999 这种长尾数字，截断精度能有效减小 JSON 体积。
        "vector_score": (
            round(chunk.vector_score, 4) if chunk.vector_score is not None else None
        ),

        # 4. 关键词检索排名（如 1, 2, 3），如果没走关键词检索，这里就是 None。
        "keyword_rank": chunk.keyword_rank,

        # 5. 关键词原始得分（ts_rank）。
        # 同样保留 4 位小数并做 None 值保护。因为 ts_rank 的数值通常较小，保留 4 位足够体现差异。
        "keyword_score": (
            round(chunk.keyword_score, 4) if chunk.keyword_score is not None else None
        ),

        # 6. RRF 融合得分。
        # 【注意】这里保留的是 6 位小数（而不是 4 位）！
        # 因为 RRF 公式是 1 / (k + rank)，算出来的分数非常小（通常在 0.01 ~ 0.03 之间）。
        # 如果只保留 4 位，很多得分会变成 0.0161 和 0.0162 这种差距极小的数字，保留 6 位能让调试面板看得更精准。
        "rrf_score": (
            round(chunk.rrf_score, 6) if chunk.rrf_score is not None else None
        ),

        # 7. 重排序得分。
        "rerank_score": (
            round(chunk.rerank_score, 4) if chunk.rerank_score is not None else None
        ),
    }



def _build_filter_payload(filters: RetrievalFilter | None) -> dict | None:
    # 1. 防御性判断：如果传入的过滤条件是 None（用户没有使用任何过滤），直接返回 None。
    if filters is None:
        return None

    # 2. 开始组装并返回字典（Payload）。
    return {
        # 【转换元组】：领域模型里是 tuple，JSON 不支持 tuple，所以用 list() 转为列表。
        "mime_types": list(filters.mime_types),

        # 【转换时间】：JSON 不支持 datetime 对象。
        # 使用三元表达式：如果时间不为 None，就调用 .isoformat() 转成类似 "2026-10-25T12:00:00" 的标准字符串。
        "created_from": (
            filters.created_from.isoformat() if filters.created_from else None
        ),

        # 同理，把结束时间转为 ISO 格式字符串。
        "created_to": (
            filters.created_to.isoformat() if filters.created_to else None
        ),

        # 【转换 UUID】：JSON 不支持 UUID 对象。
        # 遍历文档 ID 元组，把每一个 UUID 强制转换为普通字符串（str）。
        "document_ids": [str(item) for item in filters.document_ids],
    }


# 定义工具函数：用于将当前状态中的 Agent 历史步骤，序列化为一个标准的 Python 字典列表。
# 这个格式可以直接被 FastAPI 转成 JSON 返回给前端（SSE事件），或者直接存入数据库的 JSONB 字段。
def _serialize_agent_steps(state: RAGState) -> list[dict]:
    """SSE / metadata 共用的 agent_steps 载荷格式。

    state 内字段全部用原生 Python 类型，直接 JSON 序列化即可；这里做一层显式拷贝
    避免后续节点继续追加时影响已发出的事件 / 已持久化的 metadata。
    """
    # 1. 先准备一个空列表，用来装数据
    result = []

    # 2. 安全地从 state 里取出历史列表。如果 key 不存在，默认给一个空列表 []，防止报错。
    raw_steps = state.get("agent_steps", [])

    # 3. 遍历这个历史列表。这里的 step 是一个字典 (dict)。
    for step in raw_steps:
        # 4. 【核心操作】：对当前的字典进行一次浅拷贝（生成一个新的字典对象）
        step_copy = dict(step)

        # 5. 把拷贝出来的新字典塞进结果列表里
        result.append(step_copy)

    # 6. 返回最终组装好的新列表
    return result


def _build_verify_payload(result: VerifyResult, *, replacement_answer: str | None) -> dict:
    """verify_result SSE / metadata 共用载荷。

    replacement_answer 仅在 verified=False 时携带；前端按它整段替换流式出来的答案，
    与 PRD"verify 失败 -> 拒答替换"语义对齐。
    """
    # 初始化基础 payload 字典
    payload: dict = {
        "verified": result.verified,

        "reason": result.reason or None,
    }

    # 判断条件：只有在校验未通过 (verified=False) 并且提供了替换答案时
    # 才将 replacement_answer 字段加入 payload 中
    if not result.verified and replacement_answer is not None:
        payload["replacement_answer"] = replacement_answer

    return payload