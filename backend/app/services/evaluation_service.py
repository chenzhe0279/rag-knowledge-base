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


# =====================================================================
# 方法作用：评测任务（Run）的后台异步执行器。
# 通常由 FastAPI 的 BackgroundTasks 调用，跑在独立的后台进程中。
# 它的核心流程是：加载数据 -> 逐条跑 RAG -> 批量算分 -> 归因与汇总。
# 无论成功还是失败，都会在最后更新数据库中的 Run 状态，并保证已跑的明细不丢失。
# =====================================================================
async def execute_evaluation_run(run_id: UUID) -> None:
    """评测 run 异步执行器：BackgroundTasks 调用。

    流程：
    1. 加载评测集 cases
    2. 逐条调 ChatService.answer_for_evaluation，每条结束就 INSERT 一行 item
       （前端可立即轮询到进度变化）
    3. 全部跑完后批量调 RAGAS evaluate_batch 算 4 指标，回填到 items
    4. 算 Bad Case 归因 + 聚合指标，更新 run.status=completed

    任意阶段失败：run.status=failed + error_message，已写入的 items 保留。
    """
    # 记录任务开始的日志
    logger.info("evaluation run start: run_id=%s", run_id)

    try:
        # 【阶段 0：环境准备与状态更新】
        # 因为这是一个在后台运行的长任务，脱离了 HTTP 请求上下文，所以必须开一个独立的数据库 Session
        async with AsyncSessionLocal() as session:
            # 实例化仓储，从数据库中获取当前的评测任务对象
            run_repo = EvaluationRunRepository(session)
            run = await run_repo.get(run_id)

            # 防御性检查：如果任务不存在（可能被用户在前端误删了），记录警告并静默退出
            if run is None:
                logger.warning("evaluation run not found, skip: %s", run_id)
                return

            # 记录当前任务正式开始执行的时间（使用 UTC 时区）
            run.started_at = datetime.now(timezone.utc)
            # 提交数据库更新
            await session.commit()
            # 把数据集名称提取出来备用
            dataset_name = run.dataset_name

        # 加载测试集（这里会抛出异常如果数据集文件损坏，将被最外层的 except 捕获）
        cases = load_dataset(dataset_name)

        # 【阶段 1：执行 RAG 问答（单条落库）】
        # 阶段 1：逐条跑 RAG，每条独立事务写一行 item（前端能轮询到进度）
        for case in cases:
            # 调用外部辅助函数，跑单条测试用例（内部会包含调用大模型、存数据库等逻辑）
            await _run_single_case(run_id, case)

        # 【阶段 2：评测与聚合】
        # 阶段 2：批量算 RAGAS + Bad Case 归因 + 聚合
        # 调用外部函数，执行 RAGAS 打批、指标回填、归因判断、总进度汇总等操作
        await _finalize_run(run_id)

        # 【阶段 3：成功收尾】
        # 再次开启一个短会话更新最终状态
        async with AsyncSessionLocal() as session:
            # 重新获取最新的 run 对象
            run = await EvaluationRunRepository(session).get(run_id)
            if run is not None:
                # 将状态标记为“已完成”
                run.status = EvaluationRunStatus.COMPLETED
                # 记录完成时间
                run.finished_at = datetime.now(timezone.utc)
                # 提交数据库
                await session.commit()

        # 记录成功完成的日志
        logger.info("evaluation run done: run_id=%s", run_id)

    # 【全局异常处理：失败收尾】
    except Exception as exc:
        # 任何阶段的任何异常（比如代码Bug、网络断开、大模型超时），都会被这里捕获

        # 记录详细的异常堆栈日志
        logger.exception("evaluation run failed: run_id=%s", run_id)

        # 开启独立会话，把任务的失败状态写进数据库
        async with AsyncSessionLocal() as session:
            # 获取任务对象
            run = await EvaluationRunRepository(session).get(run_id)
            if run is not None:
                # 将状态标记为“失败”
                run.status = EvaluationRunStatus.FAILED
                # 记录失败/结束时间
                run.finished_at = datetime.now(timezone.utc)
                # 记录错误信息：优先取异常的字符串描述；如果为空则取异常类名；并限制最大长度 500 字符，防止超长报错撑爆数据库字段
                run.error_message = (str(exc).strip() or exc.__class__.__name__)[:500]
                # 提交数据库
                await session.commit()


# =====================================================================
# 方法作用：执行单条评测用例（Case）。
# 它是后台评测大循环中的“单次执行单元”。
# 负责：跑一次 RAG -> 算局部指标（引用命中/拒答对错）-> 保存明细（Item）-> 更新主任务（Run）进度。
# 使用独立数据库会话（Session），保证单条报错不会影响整批评测。
# =====================================================================
async def _run_single_case(run_id: UUID, case) -> None:
    """跑一条 case: 独立 session + 独立事务写一行 item。"""
    # 开启独立的数据库事务（防止因为一条报错导致整个批次被回滚，也能及时释放连接池）
    async with AsyncSessionLocal() as session:
        # 实例化聊天服务，传入当前 session
        chat_service = ChatService(session)

        # 【核心执行】调用聊天服务，执行一次非流式的完整 RAG 流程
        # 返回值 answer 包含了回答内容、引用、耗时、状态等所有快照
        answer: EvaluationAnswer = await chat_service.answer_for_evaluation(case.question)

        # 先准备一个默认值 None
        citation_hit = None

        # 只有“不该拒答”的题，才去计算引用命中率
        if not case.should_refuse:
            citation_hit = compute_citation_hit(
                actual_citations=answer.citations,
                expected_document_names=case.expected_document_names,
                expected_keywords=case.expected_keywords,
            )

        # 【局部指标计算 2：拒答正确率】
        # 对比系统实际有没有拒答（answer.refused）与期望是否应该拒答（case.should_refuse）
        refusal_correct = compute_refusal_correct(answer.refused, case.should_refuse)

        # 【数据落库准备】构建数据库实体对象 EvaluationItem
        item = EvaluationItem(
            # 关联所属的宏观评测任务 Run
            run_id=run_id,
            # ----- 以下为输入快照（从 Case 中复制） -----
            case_id=case.case_id,
            question=case.question,
            expected_answer=case.expected_answer,
            expected_document_names=case.expected_document_names,
            expected_keywords=case.expected_keywords,
            should_refuse=case.should_refuse,
            tags=case.tags,

            # ----- 以下为实际运行快照（从 Answer 中提取） -----
            actual_answer=answer.answer,
            actual_refused=answer.refused,
            citations=answer.citations,
            # 将检索到的原始文本块元数据序列化为列表字典
            retrieved_chunks_meta=[_chunk_meta(c) for c in answer.chunks],
            # 路由和步骤记录（如果是空字典则转为 None，避免数据库存脏数据）
            query_route=answer.query_route or None,
            agent_steps=answer.agent_steps or None,
            # 校验结果载荷转换
            verify_result=_verify_payload(answer.verify_result),
            trace_id=answer.trace_id,

            # ----- 性能与异常状态 -----
            latency_ms=answer.latency_ms,
            first_token_latency_ms=answer.first_token_latency_ms,
            error_message=answer.error_message,

            # ----- 前面算出来的局部指标 -----
            citation_hit=citation_hit,
            refusal_correct=refusal_correct,
        )
        # 将明细记录添加到数据库会话中
        await EvaluationItemRepository(session).add(item)

        # 【更新主任务进度】同事务更新 run 进度
        # 获取最新的评测任务对象
        run = await EvaluationRunRepository(session).get(run_id)
        if run is not None:
            # 已完成题数 + 1
            run.progress_completed += 1
            # 如果当前这条执行报错了，失败题数 + 1
            if answer.error_message:
                run.progress_failed += 1

        # 提交事务：将明细的插入和进度的更新一起提交到数据库
        # （这里不 commit 的话，数据库里是看不到进度变化的，前端轮询就刷不出新进度）
        await session.commit()


# =====================================================================
# 方法作用：评测跑完后的“收尾与汇总”阶段（Finalize）。
# 当所有测试用例都单条跑完后，进入此方法。它负责：
# 1. 把非拒答的、执行成功的样本打包，送给 RAGAS 批量算 4 大指标。
# 2. 将算出的分数回填到具体的单条明细（Item）中。
# 3. 根据各项指标，自动给每条明细打上 Bad Case 归因标签。
# 4. 计算整个任务（Run）的平均分、命中率、延迟等宏观指标并落库。
# =====================================================================
async def _finalize_run(run_id: UUID) -> None:
    """跑完所有 case 后：一次性算 RAGAS -> Bad Case 归因 -> 聚合指标。"""
    # 开启独立数据库会话
    async with AsyncSessionLocal() as session:
        item_repo = EvaluationItemRepository(session)
        # 把刚才跑完并落库的所有单条明细拉取出来
        items = await item_repo.list_by_run(run_id)
        # 如果一条都没跑成功，直接返回
        if not items:
            return

        # 拒答 case 不喂给 RAGAS（没有 retrieved_contexts, 4 指标也无意义）
        # 但仍占位以保持 items / metrics 顺序对齐
        samples_with_index: list[tuple[int, RagasSample]] = []

        # 遍历所有明细，筛选出适合做 RAGAS 评测的样本
        for idx, item in enumerate(items):
            # 过滤条件：如果是该拒答的、有报错的、或者没检索到上下文的，统统跳过不参与算分
            if item.should_refuse or item.error_message or not item.retrieved_chunks_meta:
                continue

            # 构造 RAGAS 需要的标准输入格式，并记录它原本在 items 列表中的索引（idx）
            samples_with_index.append(
                (
                    idx,
                    RagasSample(
                        question=item.question,
                        answer=item.actual_answer,
                        # 从存储的 JSON 里提取出纯文本内容
                        retrieved_contexts=[
                            str(c.get("content", "")) for c in item.retrieved_chunks_meta
                        ],
                        reference_answer=item.expected_answer,
                    ),
                )
            )

        # 初始化一个和 items 等长的打分列表，默认全填 None
        metrics_list: list[RagasMetrics | None] = [None] * len(items)

        # 如果存在需要算分的样本
        if samples_with_index:
            # 提取出样本列表，丢给 RAGAS 批量评测
            indexed_metrics = await evaluate_batch([s for _, s in samples_with_index])

            # 把算出来的结果，按照之前记录的索引，精准回填到 metrics_list 对应位置
            for (idx, _), m in zip(samples_with_index, indexed_metrics, strict=True):
                metrics_list[idx] = m

        # 遍历所有明细，把算好的得分写进对象，并进行 Bad Case 归因
        for item, metrics in zip(items, metrics_list, strict=True):
            # 只有当算出了分数（非 None）才回填
            if metrics is not None:
                item.faithfulness = metrics.faithfulness
                item.answer_relevancy = metrics.answer_relevancy
                item.context_precision = metrics.context_precision
                item.context_recall = metrics.context_recall

            # 调用我们之前看过的归因判定函数，得出这条是不是 Bad Case 及原因
            rule = classify_bad_case(
                should_refuse=item.should_refuse,
                actual_refused=item.actual_refused,
                refusal_correct=item.refusal_correct,
                citation_hit=item.citation_hit,
                faithfulness=item.faithfulness,
                answer_relevancy=item.answer_relevancy,
                context_precision=item.context_precision,
                context_recall=item.context_recall,
                has_error=bool(item.error_message),
            )
            # 将归因结果写入明细对象
            item.is_bad_case = rule.is_bad_case
            item.bad_case_category = rule.category

        # ==================== 宏观指标聚合 ====================
        # 聚合指标：None 不参与平均
        # 获取评测任务（Run）对象，准备写入总体统计信息
        run = await EvaluationRunRepository(session).get(run_id)
        if run is not None:
            # 使用辅助函数 _avg 计算 4 项 RAGAS 指标的平均分
            run.faithfulness = _avg([i.faithfulness for i in items])
            run.answer_relevancy = _avg([i.answer_relevancy for i in items])
            run.context_precision = _avg([i.context_precision for i in items])
            run.context_recall = _avg([i.context_recall for i in items])

            # 引用命中率分母排除应拒答 case
            # 提取所有非空（非拒答）的命中状态 True/False
            non_refusal_hits = [i.citation_hit for i in items if i.citation_hit is not None]
            # 计算命中率：命中的数量 / 参与计算的总数
            run.citation_hit_rate = (
                sum(1 for h in non_refusal_hits if h) / len(non_refusal_hits)
                if non_refusal_hits
                else None  # 如果全是拒答题，就没有命中率，填 None
            )

            # 拒答正确率：正确的数量 / 总题数
            run.refusal_accuracy = sum(1 for i in items if i.refusal_correct) / len(items)
            # 平均总耗时
            run.avg_latency_ms = sum(i.latency_ms for i in items) / len(items)

            # 提取所有有值的首 token 延迟
            first_token_values = [
                i.first_token_latency_ms for i in items if i.first_token_latency_ms is not None
            ]
            # 平均首 token 延迟：如果列表为空（全是拒答），则填 None
            run.avg_first_token_latency_ms = (
                sum(first_token_values) / len(first_token_values)
                if first_token_values
                else None
            )

        # 将所有回填的分数、归因结果以及 Run 的统计数据统一提交落库
        await session.commit()


# =====================================================================
# 辅助方法 1：序列化文本块元数据。
# =====================================================================
def _chunk_meta(chunk) -> dict:
    """把 RetrievedChunk 序列化成评测 items.retrieved_chunks_meta 用的轻量 dict。

    保留 content 是给 RAGAS 当 retrieved_contexts 用的；其余字段便于详情页定位。
    """
    return {
        "chunk_id": str(chunk.chunk_id),
        "document_id": str(chunk.document_id),
        "document_name": chunk.document_name,
        "page_no": chunk.page_no,
        "section_path": chunk.section_path,
        "content": chunk.content,
        "vector_score": chunk.vector_score,
        "rerank_score": chunk.rerank_score,
        "rrf_score": chunk.rrf_score,
    }


# =====================================================================
# 辅助方法 2：序列化校验结果。
# =====================================================================
def _verify_payload(result) -> dict | None:
    # 如果校验结果为空，直接返回 None
    if result is None:
        return None
    # 提取核心字段返回
    return {"verified": result.verified, "reason": result.reason or None}


# =====================================================================
# 辅助方法 3：安全求平均值（忽略 None）。
# =====================================================================
def _avg(values: list[float | None]) -> float | None:
    # 过滤掉列表中的 None 值
    nums = [v for v in values if v is not None]
    # 如果过滤完发现列表空了，直接返回 None
    if not nums:
        return None
    # 求和并除以有效数字的个数
    return sum(nums) / len(nums)