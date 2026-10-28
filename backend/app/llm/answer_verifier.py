import json
from dataclasses import dataclass

from app.core import logger
from app.llm.models import get_chat_model
from app.llm.prompts import build_verify_answer_messages, format_context
from app.retrieval.vector_retriever import RetrievedChunk


@dataclass(frozen=True)
class VerifyResult:
    """answer_verifier 单次校验结果。

    verified=True 时 reason 可能是空字符串（不需要解释为什么通过）。
    """

    verified: bool
    reason: str


class AnswerVerifier:
    """LLM 答案可信度校验器。"""

    async def verify(
            self,
            question: str,
            answer: str,
            chunks: list[RetrievedChunk],
    ) -> VerifyResult:
        # 前置条件判断：如果没有检索到任何上下文（chunks），或者模型的回答为空
        # 则直接跳过校验。原因可能是：
        # 1. 拒答场景（如业务层已标记为 refused）
        # 2. 发生异常路径，没有可供对照的参考片段
        if not chunks or not answer.strip():
            return VerifyResult(verified=True, reason="")

        # 构建发送给 LLM 校验器的 Prompt 消息列表
        messages = build_verify_answer_messages(
            question=question,
            answer=answer,
            chunks_text=format_context(chunks),  # 将检索到的 chunks 格式化为文本上下文
        )

        try:
            # 异步调用聊天模型（LLM）进行校验
            response = await get_chat_model().ainvoke(messages)
            # 从模型的响应中提取文本内容，并去除首尾空白字符
            raw = _extract_text(response.content).strip()
            # 解析模型返回的文本，转换为 VerifyResult 对象
            return _parse_result(raw)

        except Exception:
            # 异常降级处理：如果校验模型调用失败（如网络超时、API报错等）
            # 记录异常日志，包含具体的问题内容
            logger.exception(
                "answer verifier 调用失败，降级 verified=True: question=%r", question
            )
            # 【降级策略】发生异常时，默认放行（verified=True），防止因为校验器故障导致正常业务被阻断
            return VerifyResult(verified=True, reason="verifier_exception")

_verifier: AnswerVerifier | None = None

def get_answer_verifier() -> AnswerVerifier:
    global _verifier
    if _verifier is None:
        _verifier = AnswerVerifier()
    return _verifier


def _parse_result(raw: str) -> VerifyResult:
    """解析 LLM JSON 输出。任何字段非法 -> 降级 verified=True。"""
    text = raw.strip()

    # 容错：模型偶尔会把 JSON 包在 ```json ... ``` 里
    if text.startswith("```"):
        # 去掉首尾的 ```
        text = text.strip("```")
        # 如果剩下的是 json 开头，去掉 json 前缀
        if text.lower().startswith("json"):
            text = text[4:]
        # 再次清理可能产生的空白
        text = text.strip()

    try:
        # 尝试解析 JSON 字符串为 Python 字典
        data = json.loads(text)
    except json.JSONDecodeError:
        # JSON 解析失败，记录 warning，并降级为通过（避免阻塞主流程）
        logger.warning("answer verifier JSON 解析失败，降级 verified=True: raw=%r", raw)
        return VerifyResult(verified=True, reason="verifier_parse_failed")

    # 校验解析后的数据类型必须是字典
    if not isinstance(data, dict):
        return VerifyResult(verified=True, reason="verifier_parse_failed")

    # 尝试获取 verified 字段
    verified_raw = data.get("verified")

    # 严格只认布尔值；字符串 "true" / 1 等都视为非法，避免歧义
    if not isinstance(verified_raw, bool):
        logger.warning(
            "answer verifier 返回 verified 字段非布尔，降级 verified=True: raw=%r", raw
        )
        return VerifyResult(verified=True, reason="verifier_invalid_verified")

    # 获取 reason 字段，如果是 None 则转为空字符串，并去除首尾空白
    reason = str(data.get("reason") or "").strip()

    # 一切正常，返回最终解析结果
    return VerifyResult(verified=verified_raw, reason=reason)


def _extract_text(content: str | list[str | dict]) -> str:
    """兼容 langchain ChatModel 的 content 联合类型。"""
    # 如果返回的是纯字符串，直接返回
    if isinstance(content, str):
        return content

    # 如果返回的是列表（多模态或复杂结构），提取其中字典格式的 "text" 字段并拼接
    return "".join(part.get("text", "") for part in content if isinstance(part, dict))