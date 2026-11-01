from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Query, Response

from app.api.deps import DbSession
from app.api.schemas.evaluations import (
    BadCaseCategoryValue,
    DatasetInfo,
    DatasetListResponse,
    EvaluationItemPage,
    EvaluationItemRead,
    EvaluationItemUpdate,
    EvaluationRunCreate,
    EvaluationRunListItem,
    EvaluationRunPage,
    EvaluationRunRead,
)
from app.services.evaluation_service import EvaluationService, execute_evaluation_run

# 实例化 FastAPI 路由对象，设置统一前缀 /evaluations，并在 API 文档中打上 "evaluations" 标签
router = APIRouter(prefix="/evaluations", tags=["evaluations"])


# =====================================================================
# 接口作用：获取所有可用的评测数据集列表。
# 前端通常用于在创建评测任务时，渲染那个选择数据集的下拉框。
# =====================================================================
@router.get("/datasets", response_model=DatasetListResponse, operation_id="listEvaluationDatasets", summary="列出可用评测集（jsonl 文件名 + 条数）", )
async def list_evaluation_datasets(session: DbSession) -> DatasetListResponse:
    # 实例化评测服务层
    service = EvaluationService(session)
    # 调用服务层方法获取数据集列表（返回的是 (name, size) 元组列表）
    items = service.list_datasets()
    # 组装成前端需要的 Pydantic 响应模型格式并返回
    return DatasetListResponse(
        items=[DatasetInfo(name=name, size=size) for name, size in items]
    )


# =====================================================================
# 接口作用：创建一个新的评测任务（Run），并通过后台任务异步执行。
# 这是一个典型的“长耗时任务异步化”处理：接口会立即返回任务信息，
# 真正的跑批流程（需要耗时很久）会交给 FastAPI 的 BackgroundTasks 处理，
# 这样前端界面就不会因为等待评测而卡死超时。
# =====================================================================
@router.post("/runs", response_model=EvaluationRunRead, status_code=201, operation_id="createEvaluationRun", summary="创建评测 run 并通过 BackgroundTasks 异步执行",)
async def create_evaluation_run(payload: EvaluationRunCreate, session: DbSession, background_tasks: BackgroundTasks,) -> EvaluationRunRead:
    # 实例化评测服务层
    service = EvaluationService(session)

    # 调用服务层方法，在数据库里创建一条评测任务记录（状态为 RUNNING）
    run = await service.create_run(name=payload.name, dataset_name=payload.dataset_name)

    # 【核心】把耗时漫长的评测执行器函数（execute_evaluation_run）和它的参数（run.id），
    # 添加到后台任务列表。接口返回后，FastAPI 会在后台默默跑这个函数。
    background_tasks.add_task(execute_evaluation_run, run.id)

    # 立刻把刚创建好的 run 对象（包含主键 ID、状态等）返回给前端
    # model_validate 用于将 ORM 对象转换成 Pydantic 响应模型
    return EvaluationRunRead.model_validate(run)


# =====================================================================
# 接口作用：分页获取评测任务（Run）列表。
# 通常用于前端展示评测任务的历史记录页面（按创建时间倒序排列）。
# =====================================================================
@router.get("/runs", response_model=EvaluationRunPage, operation_id="listEvaluationRuns", summary="按创建时间倒序分页列出评测 run",)
async def list_evaluation_runs(session: DbSession, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),) -> EvaluationRunPage:
    # 实例化评测服务层
    service = EvaluationService(session)
    # 调用服务层方法，获取当前页的任务对象列表（items）和总条数（total）
    items, total = await service.list_runs(page=page, page_size=page_size)

    # 组装并返回分页响应模型
    return EvaluationRunPage(
        # 使用列表推导式，将数据库查出来的 ORM 对象 (r) 自动转换为 Pydantic 列表项模型
        items=[EvaluationRunListItem.model_validate(r) for r in items],
        total=total,  # 总记录数
        page=page,  # 当前页码
        page_size=page_size  # 每页条数
    )


# =====================================================================
# 接口作用：根据任务 ID 获取单个评测任务（Run）的详细状态与得分信息。
# 前端轮询进度、或者查看任务详情页时会调用此接口。
# =====================================================================
@router.get("/runs/{run_id}",response_model=EvaluationRunRead, peration_id="getEvaluationRun",)
async def get_evaluation_run(run_id: UUID, session: DbSession) -> EvaluationRunRead:
    # 实例化评测服务层
    service = EvaluationService(session)

    # 调用服务层方法获取任务详情。
    # 注意：如果数据库里没有这个 ID，service.get_run 内部会直接抛出 404 NotFoundError 异常
    run = await service.get_run(run_id)

    # 将查出的 ORM 对象转换为 Pydantic 响应模型并返回给前端
    return EvaluationRunRead.model_validate(run)


# =====================================================================
# 接口作用：删除指定的评测任务（Run）。
# 这是一个标准且优雅的 RESTful 风格删除接口。
# 如果任务不存在，Service 层会抛出 404 异常；如果删除成功，返回 204 状态码。
# =====================================================================
@router.delete("/runs/{run_id}", status_code=204, operation_id="deleteEvaluationRun",)
async def delete_evaluation_run(run_id: UUID, session: DbSession) -> Response:
    # 实例化评测服务层
    service = EvaluationService(session)
    # 调用服务层的删除方法。
    await service.delete_run(run_id)
    # 删除成功，返回一个空的 204 响应。不需要返回任何 JSON 数据
    return Response(status_code=204)



# =====================================================================
# 接口作用：分页获取指定评测任务（Run）下的所有单条明细（Item）列表。
# 支持前端的高级筛选需求：只看错题（Bad Case）或按具体的错误类型进行过滤。
# =====================================================================
@router.get("/runs/{run_id}/items", response_model=EvaluationItemPage, operation_id="listEvaluationItems",summary="分页列出 run 下的 case，支持仅看 Bad Case 与按归因筛选",)
async def list_evaluation_items(run_id: UUID, session: DbSession, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    bad_case_only: bool = Query(False), # 筛选参数：是否只看 Bad Case。默认 False（看全部）。由前端传 ?bad_case_only=true 开启
    category: BadCaseCategoryValue | None = Query(None), # 筛选参数：具体的错误归因（如 "generation_off_context"）。前端通过下拉框选择后传入
) -> EvaluationItemPage:
    # 实例化评测服务层
    service = EvaluationService(session)
    # 调用服务层方法获取分页数据和总条数
    items, total = await service.list_items(
        run_id,
        page=page,
        page_size=page_size,
        bad_case_only=bad_case_only,
        category=category,
    )
    # 组装并返回分页响应模型
    return EvaluationItemPage(
        # 将 ORM 对象列表转换为 Pydantic 模型列表
        items=[EvaluationItemRead.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
    )


# =====================================================================
# 接口作用：根据明细 ID，获取单条评测明细的详细全景数据。
# 用于前端点击列表中的某一条数据，弹出详情侧边栏或跳转到详情页。
# =====================================================================
@router.get("/items/{item_id}", response_model=EvaluationItemRead, operation_id="getEvaluationItem",)
async def get_evaluation_item(item_id: UUID, session: DbSession) -> EvaluationItemRead:
    # 实例化服务层
    service = EvaluationService(session)
    # 调用服务层获取详情（内部如果找不到会抛 404 异常）
    item = await service.get_item(item_id)
    # 转换为 Pydantic 模型并返回
    return EvaluationItemRead.model_validate(item)


# =====================================================================
# 接口作用：人工覆盖/修改指定单条评测明细（Item）的 Bad Case 归因。
# 使用 PATCH 方法，表示“局部更新”。前端只需传入需要修改的字段即可，
# 未传入的字段（如 null）将保持数据库中的原值不变。
# =====================================================================
@router.patch("/items/{item_id}", response_model=EvaluationItemRead, operation_id="updateEvaluationItem", summary="人工覆盖 Bad Case 归因 / 备注",)
async def update_evaluation_item(item_id: UUID, payload: EvaluationItemUpdate,session: DbSession,) -> EvaluationItemRead:
    # 实例化评测服务层
    service = EvaluationService(session)

    # 调用服务层的更新方法（你之前看过的 update_item_bad_case 逻辑）
    # 将前端传来的参数提取出来传入
    item = await service.update_item_bad_case(
        item_id,
        bad_case_category=payload.bad_case_category,
        bad_case_note=payload.bad_case_note,
        is_bad_case=payload.is_bad_case,
    )

    # 将更新后的 ORM 对象转为 Pydantic 模型，返回给前端
    return EvaluationItemRead.model_validate(item)