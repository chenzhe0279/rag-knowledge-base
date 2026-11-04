from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import IngestionTask, IngestionTaskStatus, IngestionTaskType


# =====================================================================
# 类作用：文档入库任务（IngestionTask）的数据库仓储层。
# 负责封装所有与任务记录相关的 CRUD 操作，以及状态流转和进度更新。
# =====================================================================
class IngestionTaskRepository:
    def __init__(self, session: AsyncSession) -> None:
        # 注入异步数据库会话
        self.session = session

    # =====================================================================
    # 方法作用：创建一个新的入库任务记录（初始状态为 PENDING）。
    # =====================================================================
    async def create(self, document_id: UUID, task_type: IngestionTaskType,) -> IngestionTask:
        # 实例化任务对象
        task = IngestionTask(
            document_id=document_id,
            task_type=task_type,
            # 新建任务默认状态为“待处理”
            status=IngestionTaskStatus.PENDING,
        )
        # 添加到数据库会话
        self.session.add(task)
        # flush 到数据库：立即执行 INSERT 语句，从而拿到数据库生成的主键 ID 和默认的创建时间
        # （注意：这里没有 commit，事务提交由外层调用者控制）
        await self.session.flush()
        # 返回带有 ID 的任务对象
        return task

    # =====================================================================
    # 方法作用：查询某个文档“最近一次”的入库任务记录。
    # 常用于前端文档列表页，展示最近一次的处理状态/进度。
    # =====================================================================
    async def get_latest_by_document(self, document_id: UUID) -> IngestionTask | None:
        """详情页「最近一次任务」卡片用：取 created_at 最新一条。"""
        # 构建查询语句
        stmt = (
            select(IngestionTask)
            # 过滤出属于指定文档的任务
            .where(IngestionTask.document_id == document_id)
            # 按创建时间降序排列（最新的在最前面）
            .order_by(IngestionTask.created_at.desc())
            # 只取第一条
            .limit(1)
        )
        # 执行查询并返回单个对象（查不到则返回 None）
        return (await self.session.execute(stmt)).scalar_one_or_none()

    # =====================================================================
    # 方法作用：将任务状态标记为“执行中（RUNNING）”，并记录开始时间。
    # =====================================================================
    async def mark_running(self, task_id: UUID) -> None:
        # 根据主键查询任务实体
        task = await self.session.get(IngestionTask, task_id)
        # 如果任务不存在，静默返回
        if task is None:
            return
        # 更新状态
        task.status = IngestionTaskStatus.RUNNING
        # 记录当前开始执行的 UTC 时间
        task.started_at = datetime.now(timezone.utc)

    # =====================================================================
    # 方法作用：将任务状态标记为“成功（SUCCESS）”，记录结束时间，并清空错误信息。
    # =====================================================================
    async def mark_success(self, task_id: UUID) -> None:
        task = await self.session.get(IngestionTask, task_id)
        if task is None:
            return
        task.status = IngestionTaskStatus.SUCCESS
        # 记录结束的 UTC 时间
        task.finished_at = datetime.now(timezone.utc)
        # 防御性清理：虽然成功了，但也要清空之前的报错（比如任务重试成功后）
        task.error_message = None

    # =====================================================================
    # 方法作用：将任务状态标记为“失败（FAILED）”，记录结束时间和具体的错误原因。
    # =====================================================================
    async def mark_failed(self, task_id: UUID, error_message: str) -> None:
        task = await self.session.get(IngestionTask, task_id)
        if task is None:
            return
        task.status = IngestionTaskStatus.FAILED
        task.finished_at = datetime.now(timezone.utc)
        # 截断错误信息：防止大模型返回的堆栈信息过长，导致数据库字段溢出或前端渲染崩溃
        task.error_message = error_message[:500]

    # =====================================================================
    # 方法作用：设置任务进度的“总数（total）”。
    # 通常在文档解析并切分完成后，确定了总共有多少个 chunk 需要处理。
    # =====================================================================
    async def set_progress_total(self, task_id: UUID, total: int) -> None:
        task = await self.session.get(IngestionTask, task_id)
        if task is None:
            return
        task.progress_total = total

    # =====================================================================
    # 方法作用：增加任务进度的“已完成数（done）”。
    # 每处理完一批 chunk，Worker 就会调用这个方法更新进度条。
    # =====================================================================
    async def increment_progress(self, task_id: UUID, delta: int) -> None:
        task = await self.session.get(IngestionTask, task_id)
        if task is None:
            return
        # 在原进度基础上增加指定的数量
        task.progress_done += delta