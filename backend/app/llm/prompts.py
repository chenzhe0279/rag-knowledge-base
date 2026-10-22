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


_ROUTE_SYSTEM = """你是 RAG 系统的查询路由器，要把用户问题归到下列 4 种策略之一：

- original: 问题清晰、表达完整、用词具体（含专有名词 / 编号 / 实体），直接检索即可。
- rewrite: 问题存在指代("它"、"这个"、"那")、省略、口语化或表达不完整，需要改写成独立完整的问题。
- hyde: 问题抽象 / 开放式("什么是..."、"为什么..."、"如何理解...")，关键词稀疏，直接检索容易召回不到。
- multi_queries: 问题包含多个角度、多个并列子问题，或者一个角度难以一次召回全（如"对比 A 和 B"、"X 的优缺点"）

只输出一个英文小写的 route 名称，不要加任何解释、引号或标点。"""


# 这段文字用于设定大模型在“查询改写（Rewrite）”任务中的角色和具体操作规范。
_REWRITE_SYSTEM = """你是一个查询改写助手。把用户问题改写成一个**独立完整**的检索查询：

- 消解指代("它"、"这个"、"那")和省略，补齐缺失主语 / 宾语。
- 把口语化表达改成书面、客观、具体的描述。
- 不要扩写、不要解释、不要回答问题。
- 输出**单行**改写后的问题，不要加引号或编号。"""


# 这段文字用于设定大模型作为“HyDE（假设性文档嵌入）助手”的角色。
# 其核心目的是让大模型先“编造”一段看似专业的答案，再用这段答案去向量库检索，从而解决用户提问太短、太抽象导致检索不到内容的问题。
_HYDE_SYSTEM = """你是一个 HyDE (Hypothetical Document Embeddings) 助手。请基于一般领域常识，
写一段**假设性的回答**用于向量召回—不需要真实，但要包含问题相关的关键词、术语和概念。

要求：
- 长度 80-200 字之间。
- 用陈述句和具体名词，多覆盖该问题相关的概念。
- 不要写"我认为"、"可能"、"假设"之类的虚词。
- 不要表达"无法回答"—HyDE 的目的就是制造可用于嵌入的稠密文本。
- 直接输出回答正文，不加标题、不加引号。"""


# 这段文字用于设定大模型作为“查询扩展助手”的角色。
# 其核心目的是将用户的单次提问，扩展成多个不同角度的子查询（Multi-Query），以便后续进行多路检索，提高召回率。
# 注意：字符串中的 {n} 是一个变量占位符，在后续调用时会替换成具体的数字（比如 3）。
_MULTI_QUERY_SYSTEM = """你是一个查询扩展助手。请把用户问题改写成 {n} 个**不同角度**的子查询，
用于多路向量召回，提高覆盖率。

要求：
- 每个子查询独立、完整、可单独检索。
- 子查询之间在角度 / 用词 / 粒度上互相错开，不要只是同义词替换。
- 每行一个子查询，**不要**编号、不要前缀、不要解释。
- 输出 {n} 行，不多不少。"""



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

# 定义用户消息模板（Human Message）。
# "{question}" 是一个变量占位符。在实际运行代码时，LangChain 会把用户真实输入的问题替换到这里。
_ROUTE_HUMAN = "{question}"

# 创建用于查询路由的对话提示词模板（Prompt Template）。
# 使用 ChatPromptTemplate.from_messages 组合出一个包含两种角色的消息列表：
# 1. 系统角色 ("system")：负责设定大模型的身份和任务规则。
# 2. 人类角色 ("human")：负责承载用户的具体提问。
# 将这两部分组合在一起，发给大模型，大模型就会按照系统提示词的规则，对用户提问进行分类。
QUERY_ROUTE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _ROUTE_SYSTEM),
        ("human", _ROUTE_HUMAN)
    ]
)

# 创建用于“查询改写”的提示词模板。
# 同样使用 ChatPromptTemplate，将系统设定的规则与用户真实的提问组装在一起发给大模型。
QUERY_REWRITE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _REWRITE_SYSTEM),
        ("human", "{question}")
    ]
)


# 创建用于 HyDE 策略的聊天提示词模板。
# 将设定好的系统规则（_HYDE_SYSTEM）与用户的实际提问（{question}）组合成标准消息列表。
HYDE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _HYDE_SYSTEM),
        ("human", "{question}")
    ]
)

# 创建用于 Multi-Query 策略的聊天提示词模板。
# 同样是使用 ChatPromptTemplate.from_messages 组合出包含系统角色（_MULTI_QUERY_SYSTEM）和人类角色（{question}）的消息列表。
# 实际运行前，除了要把 {question} 替换为用户提问外，还需要给 _MULTI_QUERY_SYSTEM 里的 {n} 传值。
MULTI_QUERY_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _MULTI_QUERY_SYSTEM),
        ("human", "{question}")
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

# 定义函数：构建用于“查询路由（Route）”的大模型消息列表
def build_route_messages(question: str) -> list[BaseMessage]:
    # 1. 将用户问题传入路由提示词模板（QUERY_ROUTE_PROMPT）进行渲染（invoke）。
    # 2. 将渲染后的 Prompt 转换为标准的 LangChain 消息对象列表（SystemMessage 和 HumanMessage）。
    # 3. 转为 list 返回，供后续发送给大模型进行路由判断。
    return list(QUERY_ROUTE_PROMPT.invoke({"question": question}).to_messages())


# 定义函数：构建用于“查询改写（Rewrite）”的大模型消息列表
def build_rewrite_messages(question: str) -> list[BaseMessage]:
    # 1. 将用户问题传入改写提示词模板（QUERY_REWRITE_PROMPT）进行渲染。
    # 2. 转换为标准的消息对象列表并返回。
    return list(QUERY_REWRITE_PROMPT.invoke({"question": question}).to_messages())


# 定义函数：构建用于“假设文档生成（HyDE）”的大模型消息列表
def build_hyde_messages(question: str) -> list[BaseMessage]:
    # 1. 将用户问题传入 HyDE 提示词模板（HYDE_PROMPT）进行渲染。
    # 2. 转换为标准的消息对象列表并返回。
    return list(HYDE_PROMPT.invoke({"question": question}).to_messages())


# 定义函数：构建用于“多路查询扩展（Multi-Query）”的大模型消息列表
# 注意：多了一个参数 n，代表需要大模型生成的子查询数量。
def build_multi_query_messages(question: str, n: int) -> list[BaseMessage]:
    # 1. 将用户问题（question）和子查询数量（n）同时传入多路查询提示词模板（MULTI_QUERY_PROMPT）进行渲染。
    # 2. 这里的 "n": n 刚好对应前面模板里的 {n} 占位符。
    # 3. 转换为标准的消息对象列表并返回。
    return list(MULTI_QUERY_PROMPT.invoke({"question": question, "n": n}).to_messages())

# 检索失败时的固定拒答文案，集中管理便于后续章节统一调整
# 定义常量：当检索到的内容相似度极低，或者根本没有检索到内容时，系统直接回复这句话，避免模型胡编乱造（幻觉）。
REFUSAL_ANSWER = "抱歉，知识库中没有找到与该问题相关的可靠依据。"