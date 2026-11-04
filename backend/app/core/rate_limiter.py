"""滑动窗口限流。

算法：Redis Sorted Set + pipeline 原子化
- 每个 key 一份用户的请求时间戳集合（score=now, member=uuid 保证不重复）
- 写之前先 zremrangebyscore 清掉过期时间戳
- zcard 拿到当前窗口内请求数
- zadd 把本次请求时间戳加入集合
- expire 给 key 续 window 秒 TTL，避免冷用户的 key 永驻 Redis
"""

import time
from functools import lru_cache
from uuid import uuid4

from app.core.config import settings
from app.core.exceptions import RateLimitedError
from app.core.logger import get_logger
from app.core.redisConfig import get_redis

# 获取当前模块的日志记录器
logger = get_logger(__name__)

# 限流窗口固定 60 秒，配合 RATE_LIMIT_PER_MINUTE 形成「每分钟 N 次」的语义
_WINDOW_SECONDS = 60


# =====================================================================
# 类作用：基于 Redis 和滑动窗口算法的限流器。
# 核心思想：记录用户每次请求的时间戳，通过清理过期的请求，并统计当前时间窗口内的请求总数，来判断是否超限。
# =====================================================================
class RateLimiter:
    def __init__(self) -> None:
        # 获取全局唯一的 Redis 客户端实例（你之前看过的单例）
        self._redis = get_redis()

    # =====================================================================
    # 方法作用：检查某个用户（identity）是否触发了限流阈值。
    # 触发限流：抛出 RateLimitedError 异常。
    # 未触发：静默放行（返回 None）。
    # =====================================================================
    async def check(self, identity: str) -> None:
        """命中阈值时抛 RateLimitedError；未命中静默返回。"""

        # 1. 获取当前的时间戳（秒级）
        now = time.time()

        # 2. 构建 Redis 中的 Key。
        # identity 通常是用户的 ID 或 IP 地址，确保每个用户的限流数据是隔离的。
        key = f"rag:rate_limit:{identity}"

        # 3. 【核心】使用 Redis Pipeline（事务）来执行这一组命令。
        # transaction=True 保证这 4 条命令打包在一起发送给 Redis，中间不会被其他用户的请求插队，保证数据一致性。
        async with self._redis.pipeline(transaction=True) as pipe:
            # 命令 A：清理旧数据。使用当前时间减去 60 秒，把 60 秒之前的时间戳从 Redis 集合中删掉。
            await pipe.zremrangebyscore(key, 0, now - _WINDOW_SECONDS)

            # 命令 B：统计当前窗口内的请求数。
            # 【注意】这里是统计**本次请求加入之前**的数量。
            await pipe.zcard(key)

            # 命令 C：把本次请求的时间戳加进去。
            # member 使用 uuid4 保证唯一性（防止同一毫秒内并发请求导致覆盖），score 是当前时间戳。
            await pipe.zadd(key, {str(uuid4()): now})

            # 命令 D：给这个 Key 续期。每次有请求进来，就把 Key 的存活时间重置为 60 秒。
            # 这样可以防止用户不活跃后，这个 Key 永远留在 Redis 里占用内存。
            await pipe.expire(key, _WINDOW_SECONDS)

            # 4. 提交并执行上面打包的 4 条命令。
            # 返回值是一个列表，对应每条命令的结果。
            # 我们只关心 zcard 的结果（第 2 条命令），所以用变量 count 去接它。
            _, count, *_ = await pipe.execute()

        # 5. 从配置文件读取允许的最大请求次数（比如 60 次/分钟）
        limit = settings.rate_limit_per_minute

        # 6. 【判定核心】如果历史请求数（count）已经大于等于阈值 limit。
        # 比如限制 60 次，如果查出来之前已经有 60 次了，那加上本次就是第 61 次，必须拦截。
        # 注：zcard 取的是 zadd 之前的计数，所以 count >= limit 即代表本次会越界
        if int(count) >= limit:
            # 记录一条警告日志，方便运维人员排查是谁在疯狂刷接口
            logger.warning(
                "rate limit exceeded: identity=%s count=%s limit=%s",
                identity,
                count,
                limit,
            )
            # 抛出你之前看过的自定义限流异常
            raise RateLimitedError(
                f"请求过于频繁，每分钟最多 {limit} 次，请稍后再试"
            )


# =====================================================================
# 函数作用：获取 RateLimiter 的单例。
# @lru_cache 保证整个应用运行期间只创建一个 RateLimiter 实例。
# =====================================================================
@lru_cache(maxsize=1)
def get_rate_limiter() -> RateLimiter:
    return RateLimiter()
