_SYSTEM_PROMPT = """你是企业知识库助手，必须严格遵守以下规则：

1. 只基于下面【参考资料】中提供的【片段】作答，禁止使用片段之外的常识或主观推断。
2. 如果所有片段都无法回答用户问题，直接回复："抱歉，知识库中没有找到相关信息。" 不要编造。
3. 回答使用简体中文，使用 Markdown 排版（必要时使用列表、加粗等结构）。
4. 引用规则（**最重要**，违反任何一条都视为错误）：
   - 在每个结论后用方括号标注片段编号，例如 [1] 或 [2][3]。
   - 编号 N 必须**精确指向**下方编号为 N 的那个片段**，并且该结论的内容能在 N 号片段的原文中**直接找到对应文字**。
   - **禁止**因为某个片段与结论"同属一份文档"就标该片段编号；同一份文档的不同片段算不同片段。
   - **禁止**把多个编号合写成 [1, 2] 或 [1-3]，多个并列写成 [1][2]。
   - **禁止**在编号外加反引号或尖括号，如 `[1]`、<1>。
   - 找不到能直接支撑该结论的片段，就**不要给那句话加引用**，宁缺毋滥。
5. 不要重复粘贴参考资料原文，只引用其中关键信息。

【正确示例】
片段 1：差旅住宿标准为一线城市每晚不超过 600 元。
片段 2：差旅日均餐补为 100 元。
回答："住宿标准为一线城市每晚不超过 600 元 [1]，餐补每日 100 元 [2]。"

【错误示例】（同一份文档不同片段，不可串用）
片段 1：差旅住宿标准为一线城市每晚不超过 600 元。
片段 2：差旅日均餐补为 100 元。
回答："餐补每日 100 元 [1]。"  ← 错：餐补信息出自片段 2，不是片段 1。

【参考资料】
{context}
"""

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from app.db.models import Message, MessageRole
from app.retrieval.vector_retriever import RetrievedChunk

# 创建用于 RAG（检索增强生成）回答的聊天提示词模板
RAG_ANSWER_PROMPT = ChatPromptTemplate.from_messages(
    [
        # 1. 系统消息 (System Message)
        # 引入之前定义好的 _SYSTEM_PROMPT（包含严格的回答规则和引用规范）
        # 它会告诉模型它的角色、需要遵守的约束以及如何输出。
        ("system", _SYSTEM_PROMPT),

        # 2. 历史对话占位符
        # MessagesPlaceholder 允许在提示词模板中动态插入一个消息列表（如多轮对话历史）。
        # optional=True 表示这是一个可选参数。如果调用时没有传入历史对话（比如第一轮提问），模板不会报错，而是自动忽略它。
        MessagesPlaceholder("chat_history", optional=True),

        # 3. 用户当前问题 (Human Message)
        # "{question}" 是一个字符串变量占位符。在实际调用大模型前，
        # LangChain 会把这里替换成用户真实输入的提问文本（比如："差旅住宿标准是多少？"）。
        ("human", "{question}"),
    ]
)


# 定义函数：将检索到的 Chunk 列表格式化为一个长字符串，供 LLM 作为参考上下文
def format_context(chunks: list[RetrievedChunk]) -> str:
    """把检索结果拼成给 LLM 的【参考资料】文本。

    用「片段 N」而非「来源：xxx」做强标记，避免 LLM 把 [N] 误解为
    "第 N 份文档"—同一文档命中多 chunk 时这种误解会导致引用张冠李戴。
    """

    # 防御性判断：如果没有检索到任何文本块
    if not chunks:
        # 返回一个占位符，防止大模型看到空字符串产生幻觉
        return "（无）"

    # 创建一个空列表，用于存放每一个格式化好的片段文本
    parts: list[str] = []

    # 遍历检索结果，enumerate 的 start=1 让索引从 1 开始（与提示词里的 [1]、[2] 编号对应）
    for index, chunk in enumerate(chunks, start=1):
        # 构造元数据前缀：包含文档名称
        meta = f"来自《{chunk.document_name}》"

        # 如果该文本块记录了页码
        if chunk.page_no is not None:
            # 在元数据后面追加页码信息
            meta += f", 第 {chunk.page_no} 页"

        # 如果该文本块记录了章节路径（例如：第一章 > 1.2节）
        if chunk.section_path:
            # 在元数据后面追加章节信息
            meta += f", 章节: {chunk.section_path}"

        # 将编号、元数据和真正的正文内容拼装成一段完整的文本，加入列表
        parts.append(f"【片段 {index}】（{meta}）\n{chunk.content}")

    # 使用带有分割线样式的换行符将所有的片段拼接成一个完整的字符串并返回
    return "\n\n---\n\n".join(parts)


# 定义函数：将数据库里的历史对话记录，转换为 LangChain 要求的消息对象列表
def history_to_messages(history: list[Message]) -> list[BaseMessage]:
    """把数据库 Message 转成 langchain BaseMessage，用于塞进 prompt。"""

    # 创建一个空列表，准备装载转换后的 LangChain 消息对象
    messages: list[BaseMessage] = []

    # 遍历从数据库里查出来的每一条消息记录
    for msg in history:
        # 如果这条消息的角色是 USER（用户）
        if msg.role == MessageRole.USER:
            # 实例化一个 HumanMessage（人类消息）对象，并追加到列表中
            messages.append(HumanMessage(content=msg.content))

        # 如果这条消息的角色是 ASSISTANT（AI 助手）
        elif msg.role == MessageRole.ASSISTANT:
            # 实例化一个 AIMessage（AI 消息）对象，并追加到列表中
            messages.append(AIMessage(content=msg.content))

        # 如果这条消息的角色是 SYSTEM（系统提示词）
        elif msg.role == MessageRole.SYSTEM:
            # 实例化一个 SystemMessage（系统消息）对象，并追加到列表中
            messages.append(SystemMessage(content=msg.content))

    # 返回转换完成的标准 LangChain 消息列表
    return messages


# 定义函数：组装最终发送给大语言模型（LLM）的完整消息列表
def build_answer_messages(
        # 参数：用户当前提出的问题字符串
        question: str,
        # 参数：通过向量检索找出来的相关文本块列表
        chunks: list[RetrievedChunk],
        # 参数：从数据库里查出来的历史对话记录列表
        history: list[Message],
        # 返回类型：LangChain 标准格式的消息对象列表（包含 System、Human、AI 等消息）
) -> list[BaseMessage]:
    """组装最终送给 LLM 的 messages 列表。"""

    # 调用之前定义好的提示词模板（RAG_ANSWER_PROMPT）的 invoke 方法。
    # invoke 的作用是接收具体的变量值，渲染模板，并返回一个完整的提示词对象（ChatPromptValue）。
    prompt_value = RAG_ANSWER_PROMPT.invoke(
        {
            # 1. 调用 format_context 函数，把检索到的 chunks 拼装成一段带标记的【参考资料】文本
            "context": format_context(chunks),
            # 2. 直接传入用户当前的提问
            "question": question,
            # 3. 调用 history_to_messages 函数，把数据库里的历史记录转换成 LangChain 的 Message 对象列表
            "chat_history": history_to_messages(history),
        }
    )

    # 将渲染后的 prompt_value 提取为标准的 Message 列表。
    # to_messages() 方法会把模板渲染结果转换成一个个的 SystemMessage、HumanMessage 等对象，最终打包成列表返回。
    return list(prompt_value.to_messages())


# 检索失败时的固定拒答文案，集中管理便于后续章节统一调整
# 定义常量：当检索到的内容相似度极低，或者根本没有检索到内容时，系统直接回复这句话，避免模型胡编乱造（幻觉）。
REFUSAL_ANSWER = "抱歉，知识库中没有找到与该问题相关的可靠依据。"