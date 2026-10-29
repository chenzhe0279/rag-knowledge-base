import dataclasses
from typing import Any

import httpx
from langsmith import traceable

from app.core.config import settings
from app.core.exceptions import ConfigurationError
from app.core.logger import get_logger
from app.retrieval.vector_retriever import RetrievedChunk

logger = get_logger(__name__)


class Reranker:
    """DashScope qwen3-rerank 客户端。

    单例持有 httpx.AsyncClient 复用连接池；rerank 是单次同步问答的一环，
    要求低延迟，所以超时设置得比 chat 短一些（默认 8s）。
    """

    # 1. 构造函数：初始化实例
    def __init__(self) -> None:
        # 声明一个私有属性，用于缓存 HTTP 客户端。
        # 初始为 None，采用“懒加载”模式，等到第一次真正发起请求时才去创建。
        self._client: httpx.AsyncClient | None = None

    # 2. 内部辅助方法：获取或创建 HTTP 客户端（单例模式）
    def _get_client(self) -> httpx.AsyncClient:
        # 如果客户端还未初始化（第一次调用）
        if self._client is None:
            # 创建 httpx 的异步客户端。
            self._client = httpx.AsyncClient(timeout=settings.rerank_timeout)
        # 返回全局唯一的客户端实例
        return self._client

    # 3. 核心方法：执行重排序
    @traceable(name=" Reranker.rerank", run_type="tool")
    async def rerank(self, query: str, candidates: list[RetrievedChunk]) -> list[RetrievedChunk]:
        # 3.1 防御性判断：如果候选列表只有 0 条或 1 条，根本不需要排序，直接原样返回，省去一次网络请求。
        if len(candidates) <= 1:
            return candidates

        # 3.2 获取 API Key。利用你在 config 里写的 @property，如果没填 rerank_key，会自动复用 chat_key。
        api_key = settings.effective_rerank_api_key

        # 3.3 如果连复用都找不到 Key，直接抛错拦截。
        if not api_key:
            raise ConfigurationError(
                "Rerank API key 未配置，请在 .env 设置 RERANK_API_KEY 或 CHAT_API_KEY"
            )

        # 3.4 开启异常捕获
        try:
            # 调用 _fetch_scores 方法，请求 DashScope API 给每一个候选打分。
            # 返回的 scores 是一个浮点数列表，与 candidates 顺序一一对应。
            scores = await self._fetch_scores(query, candidates, api_key)

        # 3.5 【核心容错】：如果调用 API 失败（比如断网、超时、限流）
        except Exception:
            # 记录详细的异常堆栈。
            logger.exception("rerank 调用失败，降级为不重排: query=%r", query)
            # 优雅降级：直接返回原本的候选列表！
            # 绝不能因为精排失败，就让整个 RAG 问答流程崩溃。大不了这次搜出来的结果顺序没那么完美。
            return candidates

        # 3.6 准备一个空列表，用来装更新了分数的新对象
        ranked = []

        # 使用 zip 把候选对象列表 (candidates) 和 分数列表 (scores) 一一对应。
        # strict=False 表示：如果两个列表长度不一样，以短的那个为准，多余的直接丢弃，绝不报错。
        paired_data = zip(candidates, scores, strict=False)

        # 遍历配对好的数据
        for chunk, score in paired_data:
            # 因为 RetrievedChunk 是不可变对象（frozen=True），不能直接写 chunk.rerank_score = score。
            # 必须用 dataclasses.replace 生成一个副本，把原来的 chunk 拷贝一份，唯独把 rerank_score 换成新的。
            new_chunk = dataclasses.replace(chunk, rerank_score=score)
            # 把生成的新对象塞进列表
            ranked.append(new_chunk)

        # 3.7 对新的列表进行降序排序。
        ranked.sort(key=lambda c: c.rerank_score or 0.0, reverse=True)

        # 3.8 返回最终精排后的 Top-K 列表
        return ranked

    async def _fetch_scores(self, query: str, candidates: list[RetrievedChunk], api_key: str) -> list[float]:
        """调 DashScope rerank 端点，返回与 candidates 同序的 relevance_score 列表。

        响应里 results 按相关度降序排好，并通过 index 指回原始 documents 数组，
        所以这里把 results 用 index 重排回输入顺序，再让上层按 rerank_score 排序，
        这样数据流更直观：candidates[i] ↔ scores[i]。
        """
        # 1. 构建发给 DashScope 的请求体 (Payload)。
        payload: dict[str, Any] = {
            "model": settings.rerank_model,  # 指定重排序模型（如 qwen3-rerank）
            "query": query,  # 用户的查询词
            "documents": [c.content for c in candidates],  # 只提取候选文档的正文进行打分
            "top_n": len(candidates),  # 要求返回的分数数量与输入的候选数量一致
        }

        # 2. 设置请求头，采用标准的 Bearer Token 认证方式
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        # 3. 获取全局单例 HTTP 客户端，发起异步 POST 请求
        client = self._get_client()
        response = await client.post(
            settings.rerank_base_url, json=payload, headers=headers
        )

        # 4. 如果 HTTP 状态码是 4xx 或 5xx（如鉴权失败、限流），这行会直接抛出异常，中断后续解析
        response.raise_for_status()

        # 5. 将响应解析为 Python 字典
        data = response.json()

        # 6. 安全提取结果列表。如果没拿到 "results" 字段，给个空列表 [] 兜底
        results = data.get("results") or []

        # 7. 如果 results 不是列表，或者是空列表，说明 API 返回了异常数据，主动抛错触发外层降级
        if not isinstance(results, list) or len(results) == 0:
            raise ValueError(f"rerank 响应缺少 results: {data!r}")

        # 8. 创建一个长度与 candidates 完全一致、初始值全为 0.0 的分数列表。
        scores: list[float] = [0.0] * len(candidates)

        # 9. 遍历 API 返回的得分结果
        for item in results:
            idx = item.get("index")  # 获取对应的原始文档索引
            score = item.get("relevance_score")  # 获取相关度分数

            # 10. 类型校验：确保 index 是整数，score 是浮点数或整数。如果有任何一个不符合，跳过这条脏数据
            if not isinstance(idx, int) or not isinstance(score, int | float):
                continue

            # 11. 越界保护：确保 API 返回的索引没有超出我们分配的 scores 列表范围，防止代码崩溃
            if 0 <= idx < len(scores):
                # 12. 将分数转为 float 后，填入对应索引位置。这样 scores 的顺序就和传入的 candidates 完美对齐了
                scores[idx] = float(score)

        # 13. 返回重排好序的分数列表
        return scores


# 声明一个全局变量 _reranker，用于实现单例模式（懒加载）
_reranker: Reranker | None = None


def get_reranker() -> Reranker:
    """获取全局唯一的 Reranker 实例"""
    # 声明要修改的是全局变量 _reranker
    global _reranker
    # 如果还没初始化过，就实例化一个
    if _reranker is None:
        _reranker = Reranker()
    # 返回单例对象
    return _reranker