"""Celery 应用实例。

启动 worker: `uv run celery -A app.celery_app worker -l info`
任务定义见 `app.ingestion.tasks`，通过 `include` 让 worker 启动时自动发现。
"""

from celery import Celery

from app.core.config import settings

# =====================================================================
# 初始化 Celery 实例
# - 第一个参数 "rag_knowledge_base" 是应用名称
# - broker: 消息中间件地址（任务队列放哪里）
# - backend: 结果存储地址（任务执行完的结果放哪里）
# - include: 告诉 Celery 启动时去哪些文件里自动寻找 @celery_app.task 定义的任务
# =====================================================================
celery_app = Celery(
    "rag_knowledge_base",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.ingestion.tasks"],
)

# =====================================================================
# Celery 全局配置更新
# 文档入库是「长任务、最终一致」语义：拿到任务先 ack，业务侧用 ingestion_tasks
# 表自己跟踪状态，不靠 broker 重传保证不丢
# =====================================================================
celery_app.conf.update(
    # 任务是否在“执行完毕”后才发送确认（ack）。
    # False 表示 Worker 一拿到任务就立刻 ack（适用于短任务，追求吞吐量）。
    # 如果设为 True（acks_late），任务执行中 Worker 崩溃了，任务会被重新投递。
    # 这里的注释说明了：长任务由业务表（ingestion_tasks）自己跟踪状态，不需要 broker 的 ack 重传机制。
    task_acks_late=False,

    # Worker 每次从队列里预取的任务数量。
    # 设为 1 是为了防止某些 Worker 抢了一堆长任务但在慢慢执行，而其他 Worker 空闲。
    # 对于耗时较长的任务（如文档解析、大模型评测），设为 1 是最佳实践。
    worker_prefetch_multiplier=1,

    # 任务参数和结果的序列化方式，统一使用 JSON，跨语言且安全
    task_serializer="json",
    result_serializer="json",

    # 允许接收的内容类型，限定为 json 防止其他格式的攻击
    accept_content=["json"],

    # 时区设置：使用 UTC 时间，防止不同服务器时区不一致导致定时任务或超时判断错乱
    timezone="UTC",
    enable_utc=True,
)