from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.core.logger import get_logger
from app.db.models import EvaluationItem, EvaluationRun, EvaluationRunStatus
from app.db.repositories.evaluation_repo import (
    EvaluationItemRepository,
    EvaluationRunRepository,
)
from app.db.session import AsyncSessionLocal
from app.evaluation import (
    classify_bad_case,
    compute_citation_hit,
    compute_refusal_correct,
    load_dataset,
)
from app.evaluation.dataset import list_datasets
from app.evaluation.ragas_runner import RagasMetrics, RagasSample, evaluate_batch
from app.services.chat_service import ChatService, EvaluationAnswer

# 获取当前模块的日志记录器
logger = get_logger(__name__)


# =====================================================================
# 类作用：评测服务层（EvaluationService）。
# 负责处理评测任务的增删改查（CRUD）业务逻辑，串联底层数据仓储（Repository）
# 和外部评测逻辑，是 API 路由层和底层数据库交互的桥梁。
# =====================================================================
class EvaluationService:
    """评测业务动作（非异步执行部分）：CRUD + 列表筛选 + Bad Case PATCH。"""

    def __init__(self,session: AsyncSession) -> None:
        # 保存数据库会话，供后续事务提交等操作使用
        self.session = session
        # 实例化“评测任务”仓储
        self.run_repo = EvaluationRunRepository(session)
        # 实例化“评测明细”仓储
        self.item_repo = EvaluationItemRepository(session)

    # =====================================================================
    # 方法作用：创建一个新的评测任务（Run）。
    # =====================================================================
    async def create_run(self, *, name: str, dataset_name: str ) -> EvaluationRun:
        # 先尝试加载评测集校验存在性 + 拿到 size，避免空 run 占位
        cases = load_dataset(dataset_name)

        # 防御性校验：如果测试集里一道题都没有，说明数据集有问题，直接抛错拒绝创建任务
        if not cases:
            raise ValidationError(f"评测集 {dataset_name} 为空")

        # 构建评测任务实体对象
        run = EvaluationRun(
            name=name,
            dataset_name=dataset_name,
            # 数据集总题数（从加载的 cases 列表长度获取）
            dataset_size=len(cases),
            # 刚创建的任务，状态默认为“运行中”
            status=EvaluationRunStatus.RUNNING,
            # 进度条总任务数等于数据集大小
            progress_total=len(cases),
        )

        # 添加到数据库会话并 flush 拿到 ID
        await self.run_repo.add(run)
        # 提交事务，真正写入数据库
        await self.session.commit()
        # 刷新实体，确保获取到数据库自动生成的完整字段（如创建时间）
        await self.session.refresh(run)
        return run

    # =====================================================================
    # 方法作用：根据 ID 获取指定的评测任务详情。
    # =====================================================================
    async def get_run(self, run_id: UUID) -> EvaluationRun:
        # 去数据库查询该任务
        run = await self.run_repo.get(run_id)

        # 如果没查到，抛出 404 异常，由 FastAPI 全局异常处理器拦截并返回前端
        if run is None:
            raise NotFoundError("评测 run 不存在")
        return run

    # =====================================================================
    # 方法作用：分页获取评测任务列表。
    # =====================================================================
    async def list_runs(self, page: int, page_size: int):
        # 直接委托给底层仓储类去执行分页查询
        return await self.run_repo.list_page(page=page, page_size=page_size)

    # =====================================================================
    # 方法作用：根据 ID 删除指定的评测任务。
    # 如果任务不存在，则抛出 404 异常；如果删除成功，则提交数据库事务。
    # =====================================================================
    async def delete_run(self, run_id: UUID) -> None:
        # 调用仓储层的 delete 方法尝试删除，返回一个布尔值（True 表示删除了，False 表示没找到）
        deleted = await self.run_repo.delete(run_id)

        # 如果返回 False，说明数据库里压根没有这个 run_id
        if not deleted:
            # 抛出业务异常，交由全局异常处理器转为 404 响应给前端
            raise NotFoundError("评测 run 不存在")

        # 删除成功，提交数据库事务，将删除操作真正持久化落盘
        await self.session.commit()

    # =====================================================================
    # 方法作用：分页获取指定评测任务（Run）下的单条明细（Item）列表。
    # 支持按“只看 Bad Case”及“具体错误分类”进行过滤。
    # =====================================================================
    async def list_items(self, run_id: UUID, page: int, page_size: int, *,
            bad_case_only: bool,   # 是否只看坏例子（默认必填，由调用方显式传入 True 或 False）
            category: str | None,  # 具体的错误分类（如 "embedding_recall_miss"），不传则默认过滤所有类型
    ):
        # 先确认 run 存在，避免空 list 和"run 不存在"混在一起
        # 调用自身的 get_run 方法，如果对应的评测任务不存在，这里会直接抛出 404 异常，阻断后续查询
        await self.get_run(run_id)

        # 确认 run 没问题后，直接委托给 Item 仓储层去执行带条件的查询
        return await self.item_repo.list_page(
            run_id,
            page=page,
            page_size=page_size,
            bad_case_only=bad_case_only,
            category=category,
        )

    # =====================================================================
    # 方法作用：根据明细 ID，获取单条具体的评测明细（Item）详情。
    # 常用于前端点击某一行数据，查看详细的问答过程、检索内容或得分。
    # =====================================================================
    async def get_item(self, item_id: UUID) -> EvaluationItem:
        # 调用仓储层去数据库查询
        item = await self.item_repo.get(item_id)

        # 如果数据库里没查到，说明数据不存在，抛出 404 异常
        if item is None:
            raise NotFoundError("评测 case 不存在")

        # 返回查到明细实体
        return item

    # =====================================================================
    # 方法作用：前端人工覆盖/修改 Bad Case（错误案例）的归因信息。
    # 允许前端修改该明细是否为 Bad Case、具体的错误分类以及人工备注。
    # 内部包含了状态联动的自动纠偏逻辑。
    # =====================================================================
    async def update_item_bad_case(self,
            item_id: UUID, # 要修改的单条评测明细 ID
            *,
            bad_case_category: str | None, # 错误分类（如 "embedding_recall_miss"），可以不传
            bad_case_note: str | None, # 人工填写的备注说明，可以不传
            is_bad_case: bool | None, # 是否标记为 Bad Case，可以不传
    ) -> EvaluationItem:
        """前端覆盖 Bad Case 归因：

        - 显式传 is_bad_case=False 时把误判 case 标回非 Bad Case 并清空归因
        - bad_case_category 非空时自动把 is_bad_case 置 True（即使前端没传）
        """
        # 先根据 ID 查询出数据库里的明细对象
        item = await self.get_item(item_id)

        # 1. 如果前端明确传了 is_bad_case=False，说明认为这是个误判，要把它踢出 Bad Case 列表
        if is_bad_case is False:
            # 取消 Bad Case 标记
            item.is_bad_case = False
            # 既然不是 Bad Case 了，之前的错误归因分类也必须清空
            item.bad_case_category = None

        # 2. 否则（前端没传状态，或者传了 is_bad_case=True）
        else:
            # 如果前端同时传了具体的错误分类
            if bad_case_category is not None:
                # 更新分类
                item.bad_case_category = bad_case_category
                # 联动逻辑：既然都有错误分类了，那它必定是个 Bad Case，自动把状态置为 True
                item.is_bad_case = True
            # 如果没传分类，但明确传了 is_bad_case=True
            elif is_bad_case is True:
                # 仅更新状态为 Bad Case（可能之前的分类保留着，或者暂时还没选分类）
                item.is_bad_case = True

        # 3. 处理备注：只要前端传了非空的备注，就更新上去
        if bad_case_note is not None:
            item.bad_case_note = bad_case_note

        # 提交数据库事务，将修改持久化落盘
        await self.session.commit()
        # 刷新对象，确保拿到数据库中最新的数据状态
        await self.session.refresh(item)
        # 返回修改后的明细对象
        return item

    # =====================================================================
    # 方法作用：获取系统中所有可用的评测数据集列表。
    # 内部直接调用了 dataset 模块里的同名函数，起到代理转发的作用。
    # =====================================================================
    def list_datasets(self) -> list[tuple[str, int]]:
        # 直接返回底层 load 函数的结果（列表元组：数据集名称，样本条数）
        return list_datasets()