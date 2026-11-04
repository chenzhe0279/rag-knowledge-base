"""Redis 异步客户端单例。

语义缓存与滑动窗口限流共用同一个连接池。Celery broker / backend 走另外的 db
索引，由 Celery 自己持有连接，与应用客户端不共享。
"""

from functools import lru_cache

import redis.asyncio as aioredis

from app.core.config import settings


# @lru_cache(maxsize=1) 是一个极其优雅的“单例模式”实现。
# 它会把函数的返回值缓存起来，maxsize=1 表示只保留一个结果。
# 这意味着在整个应用的运行期间，get_redis() 函数只会真正执行一次，后续调用都会直接返回缓存中的同一个 Redis 实例。
@lru_cache(maxsize=1)
def get_redis() -> aioredis.Redis:
    # 从配置中读取 redis_url（比如 redis://localhost:6379/0），并创建一个连接池。
    # decode_responses=True 是极其关键的参数：它告诉 Redis，返回数据时请自动把字节串（bytes）解码为 Python 字符串（str），省去了我们在业务代码里到处写 .decode('utf-8') 的麻烦。
    return aioredis.from_url(settings.redis_url, decode_responses=True)