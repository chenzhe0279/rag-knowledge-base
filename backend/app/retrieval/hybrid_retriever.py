"""混合检索器：向量 + 中文全文双路召回 + RRF 融合。

为什么用 RRF 而不是直接相加两路分数：
- 两路分数量纲完全不同（cosine sim ∈ [0,1] vs ts_rank ∈ [0,+∞)），加起来没有物理意义
- RRF 只看排名，不依赖分数尺度，是工业界混合检索事实标准
- 公式：score(d) = sum_i 1 / (k + rank_i(d))，rank 从 1 开始
- 常数 k（默认 60）越小越偏向高排名条目；越大越平滑

实现选择：在应用层用 dict 累加，而不是写一条 FULL OUTER JOIN 大 SQL，能逐行看清楚 RRF 融合到底在做什么。
"""

import asyncio
from uuid import UUID

from app.core.tracing import traceable

from app.core.config import settings
from app.core.logger import get_logger
from app.db.session import AsyncSessionLocal
from app.retrieval.filters import RetrievalFilter
from app.retrieval.keyword_retriever import KeywordRetriever
from app.retrieval.vector_retriever import RetrievedChunk, VectorRetriever

logger = get_logger(__name__)


class HybridRetriever:
    """两路独立 session 并发召回。

    刻意不接收外部 session:
    - SQLAlchemy AsyncSession 不支持并发执行，两路 gather 共用一个 session 会
      把底层 asyncpg 连接搞成 InFailedSQLTransactionError，污染调用方事务
    - 检索过程纯只读，与调用方的写事务（落库 user / assistant 消息）天然解耦
    """

    @traceable(name="HybridRetriever.search", run_type="retriever")
    async def search(self, query: str, *, recall_top_k: int, final_top_k: int, filters: RetrievalFilter | None = None,) -> list[RetrievedChunk]:
        """两路并发召回 + RRF 融合 + 取 final Top-K。

        任一路异常都退化为另一路结果，避免一处抖动阻断整个问答。
        """
        # 【并发执行核心】：asyncio.gather 用于并发运行多个异步任务。
        # 它会同时启动向量检索和关键词检索，谁先跑完谁先歇着，直到两路都跑完，再把结果按顺序返回。
        vector_hits, keyword_hits = await asyncio.gather(
            # 第一路：执行带异常保护的向量检索。
            # 传入四个参数：
            # 1. VectorRetriever：告诉 _safe_search 去实例化哪个检索类。
            # 2. query：用户的原始提问。
            # 3. recall_top_k：向量路单独召回的数量（比如先捞 20 条，给后面 RRF 融合留足弹药）。
            # 4. "vector"：一个字符串标识，用于在 _safe_search 内部打日志或标识错误来源。
            self._safe_search(VectorRetriever, query, recall_top_k, "vector", filters),

            # 第二路：执行带异常保护的关键词检索。
            # 传入的参数逻辑同上，只是检索器换成了 KeywordRetriever，标识换成了 "keyword"。
            self._safe_search(KeywordRetriever, query, recall_top_k, "keyword", filters),
        )
        return rrf_fuse(
            vector_hits=vector_hits,
            keyword_hits=keyword_hits,
            k=settings.rrf_k,
            top_k=final_top_k,
        )

    # 装饰器：声明这是一个静态方法。因为该方法不需要访问 HybridRetriever 的实例属性，直接通过类名调用即可。
    @staticmethod
    async def _safe_search(
            # 类型注解极其精妙：传入的是“类”（Class），而不是“实例对象”（Instance）。
            # 这利用了多态性，既允许传入 VectorRetriever 类，也允许传入 KeywordRetriever 类，代码高度复用。
            retriever_cls: type[VectorRetriever] | type[KeywordRetriever],
            query: str,
            top_k: int,
            label: str,
            filters: RetrievalFilter | None = None,
    ) -> list[RetrievedChunk]:

        try:
            # 【核心设计1：独立数据库会话】
            # 为什么不用外部传进来的 session？因为 asyncio.gather 会并发执行两个任务，
            # SQLAlchemy 的 AsyncSession 不支持多协程并发共享，否则会抛出事务冲突错误。
            # 这里每次调用 _safe_search 都独立开启一个短连接（用完自动关闭），彻底隔离并发事务。
            async with AsyncSessionLocal() as session:
                # 利用传入的类（Class）实例化检索器对象，并将独立会话注入进去。
                retriever = retriever_cls(session)

                # 执行真正的检索逻辑并返回结果。如果是向量类，就走 search；如果是关键词类，也走 search。
                # 等待检索完成，把数据返回给外层的 gather。
                return await retriever.search(query, top_k, filters=filters)

        # 【核心设计2：优雅降级（Graceful Degradation）】
        # 捕获任何可能的异常（如：数据库断连、pgvector 插件崩溃、分词器异常等）。
        except Exception:
            # 记录完整的异常堆栈日志。通过 label 参数，我们可以精准知道是 "vector" 那一路挂了，还是 "keyword" 那一路挂了。
            logger.exception("hybrid retrieve %s 路异常，降级为空结果", label)

            # 发生异常时，返回空列表 []。
            # 这样当 asyncio.gather 拿到结果时，出问题的那一路就是 []，没出问题的那一路是正常数据。
            # 后续的 RRF 融合算法依然可以基于单路数据算出结果，绝不会因为报错导致整个接口报 500。
            return []



# 定义 RRF（Reciprocal Rank Fusion，倒数排名融合）核心函数
# 传入两路检索的结果（向量结果、关键词结果），以及 RRF 的常数 k 和最终截取数量 top_k
def rrf_fuse(
        vector_hits: list[RetrievedChunk],
        keyword_hits: list[RetrievedChunk],
        *,
        k: int,
        top_k: int,
) -> list[RetrievedChunk]:
    """RRF 融合：rank 从 1 开始，分数 = sum 1/(k + rank)。

    保留两路的 rank / score 与命中来源，便于前端调试面板展示。
    """
    # 1. 创建一个字典，键为 chunk_id (UUID)，值为 RetrievedChunk 对象。
    # 这个字典相当于一个"大熔炉"，用于【按 ID 去重】并【累加得分】。
    # 使用 dict 可以用 O(1) 的时间复杂度快速判断一个文本块是否已经在两路中命中过。
    by_id: dict[UUID, RetrievedChunk] = {}

    # ================= 第一步：处理向量检索结果 =================
    # 遍历向量检索的结果，enumerate(start=1) 用于生成排名（第 1 名，第 2 名...）
    for rank, hit in enumerate(vector_hits, start=1):
        # 把向量检索的结果存入字典。
        # 调用 _with_vector 方法，这个方法内部应该会算出该 chunk 的 RRF 分数（1 / (k + rank)），
        # 并标记它的来源是 "vector"，然后返回一个新的 RetrievedChunk 对象。
        by_id[hit.chunk_id] = _with_vector(hit, rank=rank, k=k)

    # ================= 第二步：处理关键词检索结果 =================
    # 遍历关键词检索的结果
    for rank, hit in enumerate(keyword_hits, start=1):
        # 去字典里看看这个 chunk 之前有没有被向量检索命中过
        existing = by_id.get(hit.chunk_id)

        # 情况 A：字典里没有这个 chunk（说明它只在关键词检索中命中，向量没搜到它）
        if existing is None:
            # 调用 _with_keyword 方法，初始化它的 RRF 分数，并标记来源为 "keyword"
            by_id[hit.chunk_id] = _with_keyword(hit, rank=rank, k=k)

        # 情况 B：字典里已经有这个 chunk
        else:
            # 同 chunk 跨两路命中：合并 sources / 累加 RRF 分数
            # 调用 _merge_keyword_into 方法。这个方法非常关键：
            # 它会把关键词的排名信息合入原有的对象，把 sources 变成 ("vector", "keyword")，
            # 并且把两路的 RRF 分数加起来（1/(k+rank_vector) + 1/(k+rank_keyword)），
            # 使得它在最终排序中获得极高的分数。
            by_id[hit.chunk_id] = _merge_keyword_into(existing, hit, rank=rank, k=k)

    # ================= 第三步：排序与截断 =================
    # 对字典里的所有 value（即去重并算好综合分数的 RetrievedChunk 对象）进行排序
    fused = sorted(
        by_id.values(),
        # 排序规则：按照对象的 rrf_score 属性进行降序排列（reverse=True）。
        # 使用 `or 0.0` 是为了防御性编程：万一某个对象的 rrf_score 是 None，就当作 0.0 处理，防止排序报错。
        key=lambda c: c.rrf_score or 0.0,
        reverse=True,
    )

    # 最后，截取前 top_k 个，返回给上层去组装 Prompt
    return fused[:top_k]


# 定义内部工具函数：将“向量检索”命中的原始对象，包装成带有 RRF 分数的统一展示对象。
def _with_vector(hit: RetrievedChunk, *, rank: int, k: int) -> RetrievedChunk:
    # 【核心公式】：计算 RRF（倒数排名融合）得分。
    # 公式为：1.0 / (k + rank)。
    # 为什么加 k？k 是一个平滑常数（通常为 60）。加 k 可以防止排名第一（rank=1）时分数过大，
    # 也可以避免分母为 0。排名越靠前（rank 越小），得分越高。
    rrf_score = 1.0 / (k + rank)

    # 因为 RetrievedChunk 是冻结数据类（frozen dataclass），不可直接修改属性，
    # 所以这里必须创建一个全新的 RetrievedChunk 对象返回。
    return RetrievedChunk(
        # ===== 基础字段直接透传 =====
        chunk_id=hit.chunk_id,
        document_id=hit.document_id,
        document_name=hit.document_name,
        content=hit.content,
        page_no=hit.page_no,
        section_path=hit.section_path,

        # ===== 得分与调试字段 =====
        # 在单路命中的场景下，统一的分数字段 score 就等于 rrf_score
        score=rrf_score,

        # 标记该数据的召回来源为 "vector"（向量路）
        sources=("vector",),

        # 记录它在向量检索中的排名
        vector_rank=rank,

        # 透传向量检索原本的余弦相似度得分（如果原始对象里有的话）
        vector_score=hit.vector_score,

        # 记录算出来的 RRF 融合得分
        rrf_score=rrf_score,
    )


# 定义内部工具函数：将“关键词检索”命中的原始对象，包装成带有 RRF 分数的统一展示对象。
def _with_keyword(hit: RetrievedChunk, *, rank: int, k: int) -> RetrievedChunk:
    # 同样使用 RRF 公式计算得分：1.0 / (k + rank)
    rrf_score = 1.0 / (k + rank)

    # 创建并返回一个全新的 RetrievedChunk 对象
    return RetrievedChunk(
        # ===== 基础字段直接透传 =====
        chunk_id=hit.chunk_id,
        document_id=hit.document_id,
        document_name=hit.document_name,
        content=hit.content,
        page_no=hit.page_no,
        section_path=hit.section_path,

        # ===== 得分与调试字段 =====
        # 单路命中场景，统一得分 score 等于 rrf_score
        score=rrf_score,

        # 标记该数据的召回来源为 "keyword"（关键词路）
        sources=("keyword",),

        # 记录它在关键词检索中的排名
        keyword_rank=rank,

        # 透传关键词检索原本的 ts_rank 得分
        keyword_score=hit.keyword_score,

        # 记录算出来的 RRF 融合得分
        rrf_score=rrf_score,
    )


# 定义工具函数：当同一个文本块（Chunk）同时被“向量路”和“关键词路”命中时，进行信息合并与得分累加。
def _merge_keyword_into(
        existing: RetrievedChunk,  # existing：之前在向量路已经命中的对象（已包含向量信息）
        keyword_hit: RetrievedChunk,  # keyword_hit：刚刚在关键词路命中的对象
        *,
        rank: int,  # 在关键词路中的排名
        k: int,  # RRF 公式里的平滑常数
) -> RetrievedChunk:  # 返回一个合并了两路信息的新对象

    """existing 是已经只带 vector 信息的条目；把 keyword 路的 rank/score 叠加上来。"""

    # 【核心公式】：RRF 的累加逻辑。
    # existing.rrf_score 是向量路算出的得分（可能是 None，所以用 `or 0.0` 兜底）。
    # 1.0 / (k + rank) 是关键词路当前贡献的得分。
    # 两者相加，意味着：如果一个块在两路都排得很靠前，它的最终得分会极高。
    new_rrf = (existing.rrf_score or 0.0) + 1.0 / (k + rank)

    # 因为 RetrievedChunk 是冻结数据类（frozen=True），不能直接修改原对象，必须新建一个。
    return RetrievedChunk(
        # ===== 基础字段：沿用原来的（两路的文本内容是一样的） =====
        chunk_id=existing.chunk_id,
        document_id=existing.document_id,
        document_name=existing.document_name,
        content=existing.content,
        page_no=existing.page_no,
        section_path=existing.section_path,

        # ===== 得分与调试字段（两路合并）=====
        # 统一对外展示的最终得分（即累加后的 RRF 分）
        score=new_rrf,

        # 来源合并：标记它既是 "vector" 也是 "keyword" 命中的（双料王）
        sources=("vector", "keyword"),

        # 保留向量路的排名和原始分
        vector_rank=existing.vector_rank,
        vector_score=existing.vector_score,

        # 记录关键词路的排名和原始分（用当前命中对象的分数）
        keyword_rank=rank,
        keyword_score=keyword_hit.keyword_score,

        # 最终综合得分
        rrf_score=new_rrf,
    )