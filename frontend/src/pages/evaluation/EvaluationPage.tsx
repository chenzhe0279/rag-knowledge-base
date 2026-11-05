import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteEvaluationRun,
  getEvaluationRun,
  listDatasets,
  listEvaluationItems,
  listEvaluationRuns,
} from '../../api/evaluations'
import { ApiError, errorMessage, isAbortError } from '../../api/http'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  AlertIcon,
  BoltIcon,
  ClockIcon,
  FlaskIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  TrendIcon,
} from '../../components/Icons'
import { Pagination } from '../../components/Pagination'
import { ProgressBar } from '../../components/ProgressBar'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../components/toast/useToast'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { usePolling } from '../../hooks/usePolling'
import {
  formatDateTime,
  formatDuration,
  formatLatency,
  formatNumber,
  formatPercent,
  formatScore,
  formatShortDateTime,
  percentOf,
} from '../../lib/format'
import {
  BAD_CASE_CATEGORIES,
  BAD_CASE_LABEL,
  compositeScore,
  EVALUATION_STATUS_META,
  METRICS,
  scoreTone,
} from '../../lib/labels'
import type {
  BadCaseCategory,
  DatasetInfo,
  EvaluationItem,
  EvaluationRun,
  EvaluationRunListItem,
  Page,
} from '../../types/api'
import { CaseDialog } from './CaseDialog'
import { CreateRunDialog } from './CreateRunDialog'
import { itemScore } from './evalModel'
import './EvaluationPage.css'

const RUN_PAGE_SIZE = 8
const ITEM_PAGE_SIZE = 10
const POLL_INTERVAL = 2500

type CaseFilter = { badOnly: boolean; category: BadCaseCategory | null }

export function EvaluationPage() {
  useDocumentTitle('RAG 评测')
  const toast = useToast()

  // ---------- run 列表 ----------
  const [runPage, setRunPage] = useState(1)
  const [runs, setRuns] = useState<Page<EvaluationRunListItem> | null>(null)
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)
  const runsControllerRef = useRef<AbortController | null>(null)

  const loadRuns = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      runsControllerRef.current?.abort()
      const controller = new AbortController()
      runsControllerRef.current = controller
      if (!opts.silent) setRunsLoading(true)
      try {
        const result = await listEvaluationRuns(runPage, RUN_PAGE_SIZE, controller.signal)
        // 删除最后一条后当前页可能为空，回退一页
        if (!result.items.length && runPage > 1) {
          setRunPage((page) => page - 1)
          return
        }
        setRuns(result)
        setRunsError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        if (!opts.silent) setRunsError(errorMessage(caught, '加载评测记录失败'))
      } finally {
        if (runsControllerRef.current === controller) setRunsLoading(false)
      }
    },
    [runPage],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRuns(), 0)
    return () => {
      window.clearTimeout(timer)
      runsControllerRef.current?.abort()
    }
  }, [loadRuns])

  // ---------- 选中的 run ----------
  const [pickedId, setPickedId] = useState<string | null>(null)
  // 未手动选择时默认选中列表第一条；新建的 run 可能不在当前页，因此不强制要求出现在列表里
  const selectedId = pickedId ?? runs?.items[0]?.id ?? null

  const [detail, setDetail] = useState<EvaluationRun | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const detailControllerRef = useRef<AbortController | null>(null)

  const loadDetail = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      detailControllerRef.current?.abort()
      if (!selectedId) {
        setDetail(null)
        return
      }
      const controller = new AbortController()
      detailControllerRef.current = controller
      if (!opts.silent) {
        setDetail((current) => (current?.id === selectedId ? current : null))
        setDetailError(null)
      }
      try {
        const result = await getEvaluationRun(selectedId, controller.signal)
        setDetail(result)
        setDetailError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        if (caught instanceof ApiError && caught.status === 404) {
          setPickedId(null)
          setDetail(null)
          return
        }
        if (!opts.silent) setDetailError(errorMessage(caught, '加载评测详情失败'))
      }
    },
    [selectedId],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDetail(), 0)
    return () => {
      window.clearTimeout(timer)
      detailControllerRef.current?.abort()
    }
  }, [loadDetail])

  // ---------- case 列表 ----------
  const [itemPage, setItemPage] = useState(1)
  const [caseFilter, setCaseFilter] = useState<CaseFilter>({ badOnly: false, category: null })
  const [items, setItems] = useState<Page<EvaluationItem> | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const itemsControllerRef = useRef<AbortController | null>(null)

  const loadItems = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      itemsControllerRef.current?.abort()
      if (!selectedId) {
        setItems(null)
        return
      }
      const controller = new AbortController()
      itemsControllerRef.current = controller
      if (!opts.silent) setItemsLoading(true)
      try {
        const result = await listEvaluationItems(
          selectedId,
          {
            page: itemPage,
            pageSize: ITEM_PAGE_SIZE,
            badCaseOnly: caseFilter.badOnly,
            category: caseFilter.category,
          },
          controller.signal,
        )
        setItems(result)
        setItemsError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        if (!opts.silent) setItemsError(errorMessage(caught, '加载 case 列表失败'))
      } finally {
        if (itemsControllerRef.current === controller) setItemsLoading(false)
      }
    },
    [selectedId, itemPage, caseFilter],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void loadItems(), 0)
    return () => {
      window.clearTimeout(timer)
      itemsControllerRef.current?.abort()
    }
  }, [loadItems])

  // ---------- 评测集 ----------
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null)
  const [datasetsError, setDatasetsError] = useState<string | null>(null)

  const loadDatasets = useCallback(async (signal?: AbortSignal) => {
    setDatasetsError(null)
    try {
      const result = await listDatasets(signal)
      setDatasets(result.items)
    } catch (caught) {
      if (isAbortError(caught)) return
      setDatasetsError(errorMessage(caught, '加载评测集失败'))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => void loadDatasets(controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadDatasets])

  // ---------- 轮询：运行中时每 2.5s 刷新，终态停止 ----------
  const anyRunning =
    detail?.status === 'running' || !!runs?.items.some((run) => run.status === 'running')

  usePolling(
    () => {
      void loadRuns({ silent: true })
      if (detail?.status === 'running') {
        void loadDetail({ silent: true })
        void loadItems({ silent: true })
      }
    },
    POLL_INTERVAL,
    anyRunning,
  )

  // 列表里的状态已变为终态，但详情还停在 running：补拉一次
  const listedStatus = runs?.items.find((run) => run.id === detail?.id)?.status
  const detailStale = detail?.status === 'running' && !!listedStatus && listedStatus !== 'running'
  useEffect(() => {
    if (!detailStale) return undefined
    const timer = window.setTimeout(() => {
      void loadDetail({ silent: true })
      void loadItems({ silent: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [detailStale, loadDetail, loadItems])

  // ---------- 交互 ----------
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EvaluationRunListItem | null>(null)
  const [openItemId, setOpenItemId] = useState<string | null>(null)

  function selectRun(id: string) {
    if (id === selectedId) return
    setPickedId(id)
    setItemPage(1)
    setCaseFilter({ badOnly: false, category: null })
    setItems(null)
  }

  function changeFilter(next: CaseFilter) {
    setCaseFilter(next)
    setItemPage(1)
  }

  function refreshAll() {
    void loadRuns()
    void loadDetail()
    void loadItems()
  }

  function handleCreated(run: EvaluationRun) {
    setCreating(false)
    toast.success(`评测「${run.name}」已开始`)
    setRunPage(1)
    setPickedId(run.id)
    setItemPage(1)
    setCaseFilter({ badOnly: false, category: null })
    setDetail(run)
    setItems(null)
    void loadRuns({ silent: true })
  }

  async function confirmDelete() {
    if (!deleting) return
    await deleteEvaluationRun(deleting.id)
    toast.success(`已删除评测「${deleting.name}」`)
    if (deleting.id === selectedId) {
      setPickedId(null)
      setDetail(null)
      setItems(null)
    }
    setDeleting(null)
    void loadRuns({ silent: true })
  }

  function handleItemSaved(updated: EvaluationItem) {
    setItems((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    )
    // 筛选条件下标注变化可能让条目离开当前列表
    if (caseFilter.badOnly || caseFilter.category) void loadItems({ silent: true })
  }

  const completedCount = runs?.items.filter((run) => run.status === 'completed').length ?? 0

  return (
    <main className="page">
      <section className="page-hero">
        <div className="page-hero__copy">
          <span className="eyebrow">RAG Evaluation</span>
          <h1 className="hero-title">
            RAG 评测
            <span>质量实验室</span>
          </h1>
          <p className="hero-lead">
            用固定评测集回放完整的检索、Agent 决策与生成链路，量化忠实度、召回与拒答表现，并对
            Bad Case 做人工归因。
          </p>
          <div className="hero-tags">
            <span className="tech-tag">RAGAS</span>
            <span className="tech-tag">Citation hit</span>
            <span className="tech-tag">Refusal accuracy</span>
            <span className="tech-tag">Bad case triage</span>
          </div>
        </div>
        <div className="page-hero__aside">
          <div className="dark-block eval-summary">
            <span className="eyebrow">Run summary</span>
            <dl className="eval-summary__grid">
              <div>
                <dt>评测记录</dt>
                <dd className="num">{runs ? formatNumber(runs.total) : '—'}</dd>
              </div>
              <div>
                <dt>评测集</dt>
                <dd className="num">{datasets ? datasets.length : '—'}</dd>
              </div>
              <div>
                <dt>本页已完成</dt>
                <dd className="num">{runs ? completedCount : '—'}</dd>
              </div>
            </dl>
            <div className="eval-summary__actions">
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                <PlusIcon size={16} />
                发起评测
              </button>
              <button
                type="button"
                className="btn btn--dark"
                onClick={refreshAll}
                disabled={runsLoading}
              >
                <RefreshIcon size={16} className={runsLoading ? 'spin' : undefined} />
                刷新
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="eval-layout">
        <aside className="eval-rail glass" aria-label="评测记录">
          <div className="eval-rail__head">
            <h2>
              <FlaskIcon size={16} />
              评测记录
            </h2>
            {anyRunning ? <StatusBadge tone="accent" label="自动刷新" live /> : null}
          </div>

          {runsError ? (
            <ErrorState message={runsError} onRetry={() => void loadRuns()} />
          ) : !runs ? (
            <div className="eval-rail__list">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} height={112} radius={18} />
              ))}
            </div>
          ) : !runs.items.length ? (
            <EmptyState
              icon={<FlaskIcon size={22} />}
              title="还没有评测记录"
              description="选择一个评测集发起第一次评测。"
              action={
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
                  <PlusIcon size={14} />
                  发起评测
                </button>
              }
            />
          ) : (
            <>
              <ul className="eval-rail__list">
                {runs.items.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    active={run.id === selectedId}
                    onSelect={() => selectRun(run.id)}
                    onDelete={() => setDeleting(run)}
                  />
                ))}
              </ul>
              <Pagination
                page={runPage}
                pageSize={RUN_PAGE_SIZE}
                total={runs.total}
                onChange={setRunPage}
                disabled={runsLoading}
                unit="次"
              />
            </>
          )}
        </aside>

        <section className="eval-main" aria-live="polite">
          {detailError ? (
            <div className="glass glass--pad">
              <ErrorState message={detailError} onRetry={() => void loadDetail()} />
            </div>
          ) : !selectedId ? (
            runs && !runs.items.length ? null : (
              <div className="glass glass--pad">
                <Skeleton height={220} radius={20} />
              </div>
            )
          ) : !detail ? (
            <div className="glass glass--pad eval-detail">
              <Skeleton height={44} width="60%" />
              <div className="eval-metrics">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} height={112} radius={18} />
                ))}
              </div>
            </div>
          ) : (
            <>
              <RunDetail run={detail} />
              <CasePanel
                run={detail}
                items={items}
                loading={itemsLoading}
                error={itemsError}
                filter={caseFilter}
                page={itemPage}
                onFilter={changeFilter}
                onPage={setItemPage}
                onRetry={() => void loadItems()}
                onOpen={setOpenItemId}
              />
            </>
          )}
        </section>
      </div>

      {creating ? (
        <CreateRunDialog
          datasets={datasets}
          datasetsError={datasetsError}
          onReloadDatasets={() => void loadDatasets()}
          onClose={() => setCreating(false)}
          onCreated={handleCreated}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        title="删除评测记录"
        description={
          deleting ? (
            <>
              将删除「{deleting.name}」及其全部 case 结果与 Bad Case 标注，操作不可恢复。
              {deleting.status === 'running' ? ' 该评测仍在运行中。' : ''}
            </>
          ) : null
        }
        confirmLabel="删除"
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />

      {openItemId ? (
        <CaseDialog
          itemId={openItemId}
          onClose={() => setOpenItemId(null)}
          onSaved={handleItemSaved}
        />
      ) : null}
    </main>
  )
}

// ---------- run 卡片 ----------

function RunCard({
  run,
  active,
  onSelect,
  onDelete,
}: {
  run: EvaluationRunListItem
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const meta = EVALUATION_STATUS_META[run.status]
  const score = compositeScore(run)
  const progress = percentOf(run.progress_completed, run.progress_total)
  return (
    <li className="run-card" data-active={active}>
      <button type="button" className="run-card__main" onClick={onSelect} aria-pressed={active}>
        <span className="run-card__top">
          <StatusBadge tone={meta.tone} label={meta.label} live={meta.live} />
          <span className="faint num">{formatShortDateTime(run.created_at)}</span>
        </span>
        <strong className="run-card__name">{run.name}</strong>
        <span className="run-card__dataset mono">{run.dataset_name}</span>
        {run.status === 'running' ? (
          <span className="run-card__progress">
            <ProgressBar value={progress} label={`${run.name} 进度`} />
            <span className="num">
              {run.progress_completed}/{run.progress_total}
            </span>
          </span>
        ) : (
          <span className="run-card__stats">
            <span>
              综合
              <b className="num" data-tone={scoreTone(score)}>
                {formatScore(score, 2)}
              </b>
            </span>
            <span>
              case <b className="num">{run.dataset_size}</b>
            </span>
            {run.progress_failed ? (
              <span className="run-card__failed">
                失败 <b className="num">{run.progress_failed}</b>
              </span>
            ) : null}
          </span>
        )}
      </button>
      <button
        type="button"
        className="icon-btn icon-btn--danger run-card__delete"
        onClick={onDelete}
        aria-label={`删除评测 ${run.name}`}
        title="删除"
      >
        <TrashIcon size={15} />
      </button>
    </li>
  )
}

// ---------- run 详情 ----------

function RunDetail({ run }: { run: EvaluationRun }) {
  const meta = EVALUATION_STATUS_META[run.status]
  const score = compositeScore(run)
  const progress = percentOf(run.progress_completed, run.progress_total)
  const processed = run.progress_completed
  const failureRate = processed ? run.progress_failed / processed : null
  const running = run.status === 'running'

  return (
    <article className="glass glass--pad eval-detail">
      <header className="eval-detail__head">
        <div className="eval-detail__title">
          <span className="eyebrow">Run · {run.dataset_name}</span>
          <h2>{run.name}</h2>
        </div>
        <StatusBadge tone={meta.tone} label={meta.label} live={meta.live} />
      </header>

      <dl className="facts eval-detail__facts">
        <div>
          <dt>评测集</dt>
          <dd className="mono">{run.dataset_name}</dd>
        </div>
        <div>
          <dt>Case 数</dt>
          <dd className="num">{formatNumber(run.dataset_size)}</dd>
        </div>
        <div>
          <dt>开始时间</dt>
          <dd className="num">{formatDateTime(run.started_at ?? run.created_at)}</dd>
        </div>
        <div>
          <dt>总耗时</dt>
          <dd className="num">{running ? '进行中' : formatDuration(run.started_at, run.finished_at)}</dd>
        </div>
        <div>
          <dt>失败 case</dt>
          <dd className="num">{run.progress_failed}</dd>
        </div>
      </dl>

      {running ? (
        <div className="eval-running">
          <div className="eval-running__label">
            <span>
              正在评测第 <b className="num">{Math.min(processed + 1, run.progress_total)}</b> 条
            </span>
            <span className="num">
              {processed}/{run.progress_total} · {progress}%
            </span>
          </div>
          <ProgressBar value={progress} label="评测进度" />
          <p className="faint">指标会在全部 case 执行完毕后统一计算，页面每 2.5 秒自动刷新。</p>
        </div>
      ) : null}

      {run.status === 'failed' && run.error_message ? (
        <div className="inline-error" role="alert">
          <span className="inline-error__text">
            <AlertIcon size={15} />
            评测失败：{run.error_message}
          </span>
        </div>
      ) : null}

      <div className="eval-metrics">
        {METRICS.map((metric) => {
          const value = run[metric.key]
          const tone = scoreTone(value)
          return (
            <div key={metric.key} className="eval-metric soft-card" data-tone={tone}>
              <span className="eval-metric__label">{metric.label}</span>
              <strong className="eval-metric__value num">{formatScore(value)}</strong>
              <span className="eval-metric__bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${typeof value === 'number' ? value : 0})` }} />
              </span>
              <span className="eval-metric__desc">{metric.desc}</span>
            </div>
          )
        })}
      </div>

      <div className="eval-perf">
        <div className="eval-perf__card dark-block">
          <ClockIcon size={16} />
          <span>平均耗时</span>
          <strong className="num">{formatLatency(run.avg_latency_ms)}</strong>
        </div>
        <div className="eval-perf__card dark-block">
          <BoltIcon size={16} />
          <span>平均首 token</span>
          <strong className="num">{formatLatency(run.avg_first_token_latency_ms)}</strong>
        </div>
        <div className="eval-perf__card dark-block">
          <TrendIcon size={16} />
          <span>综合得分</span>
          <strong className="num">{formatScore(score, 3)}</strong>
        </div>
        <div className="eval-perf__card dark-block">
          <AlertIcon size={16} />
          <span>失败率</span>
          <strong className="num">{formatPercent(failureRate)}</strong>
        </div>
      </div>
    </article>
  )
}

// ---------- case 列表 ----------

function CasePanel({
  run,
  items,
  loading,
  error,
  filter,
  page,
  onFilter,
  onPage,
  onRetry,
  onOpen,
}: {
  run: EvaluationRun
  items: Page<EvaluationItem> | null
  loading: boolean
  error: string | null
  filter: CaseFilter
  page: number
  onFilter: (filter: CaseFilter) => void
  onPage: (page: number) => void
  onRetry: () => void
  onOpen: (id: string) => void
}) {
  const filtered = filter.badOnly || !!filter.category
  return (
    <article className="glass glass--pad eval-cases">
      <div className="panel-head">
        <div className="panel-head__title">
          <span className="eyebrow">Cases</span>
          <h2 className="section-title">
            逐条结果
            {items ? <small className="eval-cases__count num"> {items.total}</small> : null}
          </h2>
        </div>
        <div className="panel-head__actions">
          <div className="segmented" role="group" aria-label="case 筛选">
            <button
              type="button"
              aria-pressed={!filtered}
              onClick={() => onFilter({ badOnly: false, category: null })}
            >
              全部
            </button>
            <button
              type="button"
              aria-pressed={filter.badOnly && !filter.category}
              onClick={() => onFilter({ badOnly: true, category: null })}
            >
              只看 Bad Case
            </button>
          </div>
          <select
            className="select eval-cases__category"
            aria-label="按问题归因筛选"
            value={filter.category ?? ''}
            onChange={(event) => {
              const value = event.target.value as BadCaseCategory | ''
              onFilter(value ? { badOnly: true, category: value } : { ...filter, category: null })
            }}
          >
            <option value="">全部归因</option>
            {BAD_CASE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {BAD_CASE_LABEL[category]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !items ? (
        <div className="case-list">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={86} radius={16} />
          ))}
        </div>
      ) : !items.items.length ? (
        <EmptyState
          icon={<FlaskIcon size={22} />}
          title={filtered ? '没有符合条件的 case' : run.status === 'running' ? '第一条 case 正在执行' : '暂无 case 结果'}
          description={
            filtered
              ? '换一个筛选条件，或在 case 详情里标注 Bad Case。'
              : run.status === 'running'
                ? '每完成一条，结果会自动出现在这里。'
                : undefined
          }
        />
      ) : (
        <>
          <ul className="case-list" data-loading={loading}>
            {items.items.map((item) => (
              <CaseRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={ITEM_PAGE_SIZE}
            total={items.total}
            onChange={onPage}
            disabled={loading}
          />
        </>
      )}
    </article>
  )
}

function CaseRow({ item, onOpen }: { item: EvaluationItem; onOpen: () => void }) {
  const score = itemScore(item)
  const refusalText = item.should_refuse
    ? item.actual_refused
      ? '应拒答 · 已拒答'
      : '应拒答 · 未拒答'
    : item.actual_refused
      ? '应回答 · 误拒答'
      : '应回答 · 已回答'

  return (
    <li>
      <button type="button" className="case-row" onClick={onOpen} data-bad={item.is_bad_case}>
        <span className="case-row__main">
          <span className="case-row__id mono">{item.case_id}</span>
          <strong className="case-row__question clamp-2">{item.question}</strong>
          <span className="case-row__tags">
            {item.is_bad_case ? (
              <span className="badge" data-tone="danger">
                Bad Case
                {item.bad_case_category ? ` · ${BAD_CASE_LABEL[item.bad_case_category]}` : ''}
              </span>
            ) : null}
            {item.error_message ? (
              <span className="badge" data-tone="danger">
                执行出错
              </span>
            ) : null}
            <span className="badge" data-tone={item.refusal_correct ? 'success' : 'warning'}>
              {refusalText}
            </span>
            {item.citation_hit === true ? (
              <span className="badge" data-tone="success">
                引用命中
              </span>
            ) : item.citation_hit === false ? (
              <span className="badge" data-tone="warning">
                引用未命中
              </span>
            ) : null}
          </span>
        </span>
        <span className="case-row__side">
          <span className="case-row__score num" data-tone={scoreTone(score)}>
            {formatScore(score, 2)}
          </span>
          <span className="faint num">{formatLatency(item.latency_ms)}</span>
        </span>
      </button>
    </li>
  )
}
