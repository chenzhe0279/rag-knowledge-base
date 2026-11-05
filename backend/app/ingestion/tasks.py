"""Celery 任务定义。

worker 是同步进程，业务流程都是 async，所以任务函数内部用 `asyncio.run`
起独立 event loop 跑 pipeline。
"""

from uuid import UUID

from app.celery_app import celery_app
from app.ingestion.pipeline import run_ingest_sync, run_reindex_sync


# =====================================================================
# 任务作用：首次入库任务。
# 当用户上传新文档时，被丢进 Celery 队列执行。
# =====================================================================
# @celery_app.task 告诉 Celery 这是一个任务。
# bind=True 允许任务函数通过第一个参数 self 访问任务本身的元数据（比如 self.request.id，用于获取重试次数等）
@celery_app.task(name="ingest_document", bind=True)
def ingest_document_task(self, document_id: str, task_id: str) -> None:
    """首次入库任务。"""
    # 【关键点】为什么入参是 str 而不是 UUID？
    # 因为 Celery 消息中间件（Redis）传输的是 JSON 字符串，直接传 UUID 对象会报错，所以先传字符串。
    # 在函数内部，用 UUID() 将其转回真正的 UUID 对象，再传给底层处理逻辑。
    run_ingest_sync(UUID(document_id), UUID(task_id))


# =====================================================================
# 任务作用：增量重建任务。
# 当文档内容更新时，只对变化的 chunk 重新计算向量，节约成本和算力。
# =====================================================================
@celery_app.task(name="reindex_document", bind=True)
def reindex_document_task(self, document_id: str, task_id: str) -> None:
    """增量重建任务。"""
    # 同样，先安全地将字符串转换为 UUID 对象，再执行重建逻辑
    run_reindex_sync(UUID(document_id), UUID(task_id))