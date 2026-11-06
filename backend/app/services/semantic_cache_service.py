import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache

from redisvl.extensions.cache.llm import SemanticCache
from redisvl.query.filter import Tag
from redisvl.utils.vectorize import CustomVectorizer

from app.core.config import settings
from app.core.logger import get_logger

# 定义 Redis 中语义缓存使用的索引名称
_CACHE_NAME = "rag_semantic_cache"
# 定义用于区分权限范围的字段名
_SCOPE_FIELD = "permission_scope"


# =====================================================================
# 函数作用：将用户的权限标签列表，转换成用于精确比对的单一哈希值。
# 解决 Redis 搜索 Tag 默认是“包含任意一个即可(any-of)”的问题。
# =====================================================================
def _scope_key(permission_scope: list[str]) -> str:
    """把权限集合序列化成「集合相等」可比较的 Tag 值。

    RediSearch Tag 字段天然是「any-of」语义；要表达「集合完全相等」最稳的做法
    是对排序后的权限串做 hash，作为单一 Tag 值存入。这样不同顺序、不同子集
    都会落到不同的 Tag，命中查询天然要求集合完全一致。
    """
    # 1. 先对权限列表进行排序（sorted），保证 ["a", "b"] 和 ["b", "a"] 产生的字符串完全一样。
    # 2. 用不可见的空字符 "\x00" 作为分隔符拼接。用 "\x00" 是为了防止 ["a,b"] 和 ["a", "b"] 拼接后产生歧义。
    canonical = "\x00".join(sorted(permission_scope))

    # 3. 对拼接好的规范字符串计算 SHA-256 哈希。
    # 最终返回一串十六进制的哈希值，不同权限组合必定产生不同哈希（极大概率），且长度固定。
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# =====================================================================
# 函数作用：这是一个“占位”的向量化函数（Stub）。
# 它唯一的用途，是在 RedisVL 初始化（建索引）时，告诉系统向量的维度是多少。
# =====================================================================
def _stub_embed(text: str, **_: object) -> list[float]:
    """占位 vectorizer：仅用于让 RedisVL 在建索引时知道向量维度。

    主链路始终预先调用项目自己的 embedder 算好 query_embedding，
    再通过 `vector=` 参数直接传给 acheck/astore，永远不会触发到这里。
    """
    # 直接返回一个全为 0.0 的列表，长度由 settings.embedding_dim（配置中的向量维度，如 1024）决定。
    return [0.0] * settings.embedding_dim


# 获取当前模块的日志记录器
logger = get_logger(__name__)


# =====================================================================
# 类作用：定义从缓存中取出的回答数据结构（不可变对象）。
# =====================================================================
@dataclass(frozen=True)
class CachedAnswer:
    # 缓存的完整回答文本
    answer: str
    # 缓存的引用列表（JSON 格式）
    citations: list[dict]
    # 命中的历史问题（用户原话），方便调试或前端展示
    cached_question: str


# =====================================================================
# 类作用：语义缓存服务层。
# 负责与 RedisVL 交互，实现基于向量相似度和权限隔离的缓存读写。
# =====================================================================
class SemanticCacheService:
    # 初始化方法
    def __init__(self) -> None:
        # 【加固】缓存初始化失败（Redis 缺 RediSearch / 连不上）只禁用缓存，
        # 绝不把异常抛给问答主链路
        self._cache: SemanticCache | None = None
        try:
         # 实例化 RedisVL 的 SemanticCache 核心对象
         self._cache = SemanticCache(
             # 缓存索引的名称
             name=_CACHE_NAME,
             # 从配置读取 Redis 连接 URL
             redis_url=settings.redis_url,
             # RediSearch 用「余弦距离 = 1 - 余弦相似度」做 KNN 排序；阈值同步转换。
             # 假设配置的相似度是 0.92，那么距离阈值就是 1.0 - 0.92 = 0.08。距离小于 0.08 才算命中。
             distance_threshold=1.0 - settings.semantic_cache_min_similarity,
             # 缓存过期时间（秒）
             ttl=settings.semantic_cache_ttl_seconds,
             # 占位向量化函数。仅用于建索引时告诉 RedisVL 向量维度，主链路传入的已经是算好的向量了
             vectorizer=CustomVectorizer(_stub_embed),  # pyright: ignore[reportCallIssue]
             # 声明可过滤的字段：权限范围。类型为 Tag，用于后续的精确匹配隔离
             filterable_fields=[{"name": _SCOPE_FIELD, "type": "tag"}],
             # 如果索引已存在，不覆盖（防止每次启动重建，丢失已有缓存）
             overwrite=False,
         )
        except Exception:
            logger.exception(
                "semantic cache init failed; cache disabled "
                "(Redis 需支持 RediSearch FT.* 命令)"
            )

    # =====================================================================
    # 方法作用：查询语义缓存。
    # 只有向量相似度达标，且权限 Tag 完全一致时，才会返回缓存结果。
    # =====================================================================
    async def lookup(self, query_embedding: list[float], permission_scope: list[str],) -> CachedAnswer | None:
        """Redis 内 KNN 查询：相似度阈值 + 权限范围 Tag 同时满足才返回。"""
        if self._cache is None:  # 缓存不可用时直接当未命中
            return None

        # 1. 将用户的权限标签列表计算成固定的哈希值（作为 Tag 值）
        scope = _scope_key(permission_scope)

        try:
            # 2. 向 Redis 发起异步查询
            hits = await self._cache.acheck(
                # 传入用户提问的向量
                vector=query_embedding,
                # 过滤条件：数据库里存的权限 Hash 必须和用户的权限 Hash 完全相等
                filter_expression=Tag(_SCOPE_FIELD) == scope,
                # 只需要返回最匹配的 1 条结果
                num_results=1,
                # 指定返回哪些字段，节省网络传输带宽
                return_fields=["prompt", "response", "metadata"],
            )
        except Exception:
            # 3. 容错处理：如果 Redis 挂了或查询报错，记录异常并当做“未命中”处理，绝不能卡死主业务
            logger.exception("semantic cache lookup failed, treat as miss")
            return None

        # 4. 如果 Redis 返回的列表为空，说明没有命中
        if not hits:
            return None

        # 5. 提取第一条命中结果
        hit = hits[0]
        # 安全获取元数据（通常是 JSON 字符串或者字典）
        metadata = hit.get("metadata") or {}

        # 6. 如果元数据是字符串（Redis 经常原样返回 JSON 字符串），需要反序列化
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = {}

        # 7. 组装并返回强类型的 CachedAnswer 对象
        return CachedAnswer(
            answer=hit.get("response", ""),
            citations=metadata.get("citations", []),
            cached_question=hit.get("prompt", ""),
        )

    # =====================================================================
    # 方法作用：将新的问答结果写入语义缓存。
    # =====================================================================
    async def save(self, *, question: str, query_embedding: list[float], answer: str, citations: list[dict], permission_scope: list[str],) -> None:
        if self._cache is None:  # 缓存不可用时直接当未命中
            return
        try:
            # 调用 RedisVL 异步写入方法
            await self._cache.astore(
                # 用户的原始问题
                prompt=question,
                # 大模型的回答
                response=answer,
                # 用户问题的向量表示
                vector=query_embedding,
                # 附加的元数据（如引用片段），存入 Redis 前会被自动序列化
                metadata={"citations": citations},
                # 权限过滤字段：存入计算好的权限 Hash Tag
                filters={_SCOPE_FIELD: _scope_key(permission_scope)},
            )
        except Exception:
            # 写缓存失败不影响主链路：用户已经拿到答案，缓存只是优化
            # 同样只记录日志，不向上抛出异常，保证用户体验无损
            logger.exception("semantic cache save failed, skip")


# =====================================================================
# 函数作用：获取语义缓存服务的单例。
# 使用 lru_cache 保证全局只有一个 SemanticCacheService 实例（以及它的 Redis 连接池）。
# =====================================================================
@lru_cache(maxsize=1)
def get_semantic_cache() -> SemanticCacheService:
    return SemanticCacheService()