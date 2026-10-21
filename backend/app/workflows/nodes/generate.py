from collections.abc import AsyncIterator
from app.llm.models import get_chat_model
from app.llm.prompts import build_answer_messages
from app.workflows.rag_state import RAGState


# 定义异步生成器函数：执行流式生成
# 返回类型标注为 AsyncIterator[str]，表示这是一个可以异步遍历（async for）并逐个吐出字符串的生成器
async def stream_generate(state: RAGState) -> AsyncIterator[str]:
    """流式生成：逐 token yield。

    调用方负责拼接成完整答案并写回 state；这里只关心"逐块输出"。
    refused 状态下调用方应直接跳过本函数。
    """

    # 1. 组装发送给大模型的完整消息列表。
    # 从 state 中提取用户提问、检索到的文本块、以及历史对话记录（如果 state 里没有 chat_history，则给个空列表兜底）。
    messages = build_answer_messages(
        question=state["question"],
        chunks=state["retrieved_chunks"],
        history=state.get("chat_history", []),
    )

    # 2. 调用大模型进行流式生成。
    # get_chat_model() 获取模型实例，astream() 是 LangChain 的异步流式接口。
    # 它会像打字机一样，每次返回一小段生成的内容（chunk）。
    async for chunk in get_chat_model().astream(messages):

        # 提取当前 chunk 中的文本内容
        text = chunk.content

        # 3. 如果当前 chunk 没有文本（比如只包含一些元数据或工具调用的空块），直接跳过
        if not text:
            continue

        # langchain 的 content 类型是 str | list[str | dict]，本章只用纯文本模型，
        # 理论上一直走 str 分支；list 分支兜底是为了过 pyright 的类型检查。
        # 4. 判断内容是否为纯文本（字符串）
        if isinstance(text, str):
            # 如果是纯字符串，直接将其 yield 出去（交由调用方去拼接并推给前端）
            yield text
        else:
            # 5. 兼容复杂结构（兜底逻辑）
            # 如果 text 是一个列表（LangChain 中多模态或复杂返回格式），
            # 则遍历列表，提取其中字典类型（dict）的 "text" 字段，并拼接成字符串 yield 出去。
            yield "".join(part.get("text", "") for part in text if isinstance(part, dict))