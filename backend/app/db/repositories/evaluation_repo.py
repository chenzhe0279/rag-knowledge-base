from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EvaluationItem, EvaluationRun


class EvaluationRunRepository:
    """评测任务（EvaluationRun）的数据库仓储层。"""

    def __init__(self, session: AsyncSession) -> None:
        # 注入异步数据库会话对象
        self.session = session

    async def add(self, run: EvaluationRun) -> None:
        """将新的评测任务对象添加到数据库会话中。"""
        # 把对象放入 Session 的待处理队列
        self.session.add(run)
        # 【重点】调用 flush() 发送 INSERT 语句给数据库。
        # 它不会真正 commit 提交（提交由上层 Service 控制），但能立刻拿到数据库生成的主键 ID 和默认值。
        await self.session.flush()

    async def get(self, run_id: UUID) -> EvaluationRun | None:
        """根据主键 ID 获取评测任务（如果不存在返回 None）。"""
        # self.session.get 是最高效的主键查询方式（会优先从内存缓存中找）
        return await self.session.get(EvaluationRun, run_id)

    async def list_page(self, page: int, page_size: int) -> tuple[list[EvaluationRun], int]:
        """分页获取评测任务列表（按创建时间倒序）。"""
        # --- 1. 安全校验与偏移量计算 ---
        # 确保页码至少为 1
        page = max(page, 1)
        # 确保每页条数在 1 到 100 之间，防止前端恶意传超大数字导致数据库崩溃
        page_size = max(min(page_size, 100), 1)
        # 计算 SQL 的 OFFSET（跳过前面多少条）
        offset = (page - 1) * page_size

        # --- 2. 构建查询语句 ---
        stmt = (
            select(EvaluationRun)
            # 按创建时间倒序（最新的在最前面），如果时间一样，用 id 倒序保证分页稳定性
            .order_by(EvaluationRun.created_at.desc(), EvaluationRun.id.desc())
            .limit(page_size)
            .offset(offset)
        )

        # 执行查询，.scalars() 表示只提取 EvaluationRun 实体对象，.all() 转成列表
        items = list((await self.session.execute(stmt)).scalars().all())

        # --- 3. 查询总记录数（用于前端分页组件计算总页数） ---
        total = int(
            (await self.session.execute(select(func.count(EvaluationRun.id)))).scalar_one()
        )
        return items, total

    async def delete(self, run_id: UUID) -> bool:
        """根据 ID 删除评测任务。返回是否真正删除成功。"""
        # 先尝试查询该记录是否存在
        run = await self.get(run_id)
        # 如果不存在，直接返回 False（交由上层 Service 抛 404 异常）
        if run is None:
            return False

        # 标记为删除状态，准备发送 DELETE 语句
        await self.session.delete(run)
        # 立即执行 SQL（同样不 commit，等待上层统一提交事务）
        await self.session.flush()
        # 删除成功
        return True



class EvaluationItemRepository:
    """评测明细（EvaluationItem）的数据库仓储层。"""

    def __init__(self, session: AsyncSession) -> None:
        # 注入异步数据库会话
        self.session = session

    async def bulk_add(self, items: Sequence[EvaluationItem]) -> None:
        """【批量添加】一次性把成百上千条评测明细塞进数据库。"""
        # 如果传入的是空列表，直接返回，避免无意义的数据库操作
        if not items:
            return
        # add_all 会比循环调用 add 性能好很多
        self.session.add_all(items)
        # 刷入数据库，生成自增主键和默认值，但不 commit（由外层统一控制事务）
        await self.session.flush()

    async def add(self, item: EvaluationItem) -> None:
        """【单条添加】添加一条评测明细。"""
        self.session.add(item)
        await self.session.flush()

    async def get(self, item_id: UUID) -> EvaluationItem | None:
        """【按 ID 查询】根据主键获取一条明细详情。"""
        # 使用 session.get 效率最高，如果没找到会返回 None
        return await self.session.get(EvaluationItem, item_id)

    async def list_by_run(self, run_id: UUID) -> list[EvaluationItem]:
        """取整个 run 的全部 items，用于跑完后批量算 RAGAS。"""
        # 构建查询语句：查询 EvaluationItem
        stmt = (
            select(EvaluationItem)
            # 过滤条件：必须属于指定的评测任务（run_id）
            .where(EvaluationItem.run_id == run_id)
            # 按创建时间正序排，如果时间一样按 ID 正序排，保证输出顺序绝对稳定
            .order_by(EvaluationItem.created_at.asc(), EvaluationItem.id.asc())
        )
        # 执行查询，提取纯净的实体对象列表并返回
        return list((await self.session.execute(stmt)).scalars().all())


    async def list_page(self, run_id: UUID, page: int, page_size: int, *,
                        bad_case_only: bool = False,  # 是否只查 Bad Case
                        category: str | None = None,  # 指定分类
                        ) -> tuple[list[EvaluationItem], int]:
        """获取评测明细列表（支持按 Bad Case 和分类过滤）。"""

        # --- 1. 分页参数安全校验 ---
        page = max(page, 1)
        page_size = max(min(page_size, 100), 1)
        offset = (page - 1) * page_size

        # --- 2. 动态构建查询条件 ---
        # 初始化条件列表，第一个条件是必传的：必须属于指定的评测任务（run_id）
        filters = [EvaluationItem.run_id == run_id]

        # 如果要求只查 Bad Case，就追加这个条件
        if bad_case_only:
            # 使用 .is_(True) 比 == True 更规范，生成的 SQL 语义更明确
            filters.append(EvaluationItem.is_bad_case.is_(True))

        # 如果传了具体的分类（如 "检索错误"），就追加分类匹配条件
        if category:
            filters.append(EvaluationItem.bad_case_category == category)

        # --- 3. 执行主查询获取当前页数据 ---
        stmt = (
            select(EvaluationItem)
            # 【核心技巧】.where(*filters)：使用星号 * 把列表解包成多个独立的条件
            # 相当于 .where(条件1, 条件2, 条件3...)，多个条件之间默认是 AND 关系
            .where(*filters)
            .order_by(EvaluationItem.created_at.asc(), EvaluationItem.id.asc())
            .limit(page_size)
            .offset(offset)
        )
        items = list((await self.session.execute(stmt)).scalars().all())

        # --- 4. 执行统计查询获取总条数 ---
        # 【重要】这里的查询条件必须和上面主查询一模一样（同样用 *filters），否则算出来的总数不对
        total_stmt = select(func.count(EvaluationItem.id)).where(*filters)
        total = int((await self.session.execute(total_stmt)).scalar_one())

        return items, total