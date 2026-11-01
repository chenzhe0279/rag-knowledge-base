import { useEffect, useState } from 'react'
import {
  EvaluationsApiError,
  deleteEvaluationRun,
  getEvaluationRun,
  listEvaluationDatasets,
  listEvaluationItems,
  listEvaluationRuns,
} from '../api/evaluations'
import { EvaluationCreateDialog } from '../components/EvaluationCreateDialog'
import { EvaluationItemDetail } from '../components/EvaluationItemDetail'
import {
  AlertIcon,
  ChevronRightIcon,
  EvaluationIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from '../components/Icons'
import { Spinner } from '../components/Spinner'
import {
  BAD_CASE_CATEGORY_META,
  BAD_CASE_CATEGORY_OPTIONS,
  EVALUATION_METRICS,
  EVALUATION_STATUS_META,
  formatEvaluationScore,
  formatLatency,
  formatProgress,
  formatRunDuration,
  getRunOverallScore,
  progressPercent,
  scorePercent,
} from '../lib/evaluations'
import { formatDateTime } from '../lib/format'
import type {
  BadCaseCategoryValue,
  DatasetInfo,
  EvaluationItem,
  EvaluationRun,
  EvaluationRunListItem,
} from '../types/evaluations'
import './EvaluationPage.css'

const RUN_PAGE_SIZE = 8
const ITEM_PAGE_SIZE = 8

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isNotFound(error: unknown): boolean {
  return error instanceof EvaluationsApiError && error.status === 404
}

function RunStatus({ status }: { status: EvaluationRunListItem['status'] }) {
  const meta = EVALUATION_STATUS_META[status]
  return (
    <span className={`eval-status eval-status--${status}`}>
      <i aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function MetricCard({
  label,
  caption,
  description,
  value,
}: {
  label: string
  caption: string
  description: string
  value: number | null | undefined
}) {
  const percent = scorePercent(value)
  return (
    <div className="eval-metric" title={description}>
      <span className="eval-metric__caption">{caption}</span>
      <div className="eval-metric__value">
        <strong>{formatEvaluationScore(value, 3)}</strong>
        <span>{percent === null ? '待计算' : `${percent}%`}</span>
      </div>
      <div className="eval-metric__track" aria-hidden="true">
        <i style={{ width: `${percent ?? 0}%` }} />
      </div>
      <span className="eval-metric__label">{label}</span>
    </div>
  )
}

export function EvaluationPage() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [runs, setRuns] = useState<EvaluationRunListItem[]>([])
  const [runsPage, setRunsPage] = useState(1)
  const [runsTotal, setRunsTotal] = useState(0)
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<EvaluationRun | null>(null)
  const [runLoading, setRunLoading] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [items, setItems] = useState<EvaluationItem[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsPage, setItemsPage] = useState(1)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [badCaseOnly, setBadCaseOnly] = useState(false)
  const [category, setCategory] = useState<BadCaseCategoryValue | ''>('')

  const [createOpen, setCreateOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<EvaluationItem | null>(null)

  useEffect(() => {
    let active = true

    Promise.all([
      listEvaluationDatasets(),
      listEvaluationRuns(1, RUN_PAGE_SIZE),
    ])
      .then(([datasetResponse, runPage]) => {
        if (!active) {
          return
        }
        setDatasets(datasetResponse.items)
        setRuns(runPage.items)
        setRunsTotal(runPage.total)
        setRunsPage(runPage.page)
        setRunsError(null)

        const first = runPage.items[0]
        if (first) {
          setSelectedRunId(first.id)
          setRunLoading(true)
          setItemsLoading(true)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setRunsError(errorMessage(loadError, '评测任务加载失败'))
        }
      })
      .finally(() => {
        if (active) {
          setRunsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedRunId) {
      return
    }

    let active = true

    Promise.all([
      getEvaluationRun(selectedRunId),
      listEvaluationItems(selectedRunId, {
        page: itemsPage,
        pageSize: ITEM_PAGE_SIZE,
        badCaseOnly,
        category: category || null,
      }),
    ])
      .then(([run, itemPage]) => {
        if (!active) {
          return
        }
        setSelectedRun(run)
        setRunError(null)
        setItems(itemPage.items)
        setItemsTotal(itemPage.total)
        setItemsError(null)
        setRuns((current) =>
          current.map((item) =>
            item.id === run.id
              ? {
                  ...item,
                  ...run,
                }
              : item,
          ),
        )
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return
        }
        if (isNotFound(loadError)) {
          setSelectedRunId(null)
          setSelectedRun(null)
          setItems([])
          setItemsTotal(0)
          setRunError('该评测任务已被删除')
        } else {
          setRunError(errorMessage(loadError, '评测详情加载失败'))
        }
      })
      .finally(() => {
        if (active) {
          setRunLoading(false)
          setItemsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedRunId, itemsPage, badCaseOnly, category])

  useEffect(() => {
    if (!selectedRunId || selectedRun?.status !== 'running') {
      return
    }

    let active = true

    const timer = window.setInterval(() => {
      getEvaluationRun(selectedRunId)
        .then((run) => {
          if (!active) {
            return
          }
          setSelectedRun(run)
          setRuns((current) =>
            current.map((item) =>
              item.id === run.id ? { ...item, ...run } : item,
            ),
          )
        })
        .catch(() => {
          // 轮询失败时保留上一帧，避免进度面板闪烁。
        })

      listEvaluationItems(selectedRunId, {
        page: itemsPage,
        pageSize: ITEM_PAGE_SIZE,
        badCaseOnly,
        category: category || null,
      })
        .then((page) => {
          if (!active) {
            return
          }
          setItems(page.items)
          setItemsTotal(page.total)
        })
        .catch(() => {
          // 下一轮继续尝试。
        })
    }, 2500)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selectedRunId, selectedRun?.status, itemsPage, badCaseOnly, category])

  const runTotalPages = Math.max(1, Math.ceil(runsTotal / RUN_PAGE_SIZE))
  const itemTotalPages = Math.max(1, Math.ceil(itemsTotal / ITEM_PAGE_SIZE))
  const completedRuns = runs.filter((run) => run.status === 'completed').length

  const selectRun = (runId: string) => {
    if (runId === selectedRunId) {
      return
    }
    setSelectedRunId(runId)
    setSelectedRun(null)
    setItems([])
    setItemsTotal(0)
    setItemsPage(1)
    setBadCaseOnly(false)
    setCategory('')
    setRunLoading(true)
    setItemsLoading(true)
    setRunError(null)
    setItemsError(null)
  }

  const loadRunPage = async (page: number, selectFirst = false) => {
    setRunsLoading(true)
    setRunsError(null)

    try {
      const runPage = await listEvaluationRuns(page, RUN_PAGE_SIZE)
      setRuns(runPage.items)
      setRunsTotal(runPage.total)
      setRunsPage(runPage.page)

      const currentVisible = runPage.items.some(
        (item) => item.id === selectedRunId,
      )
      if (selectFirst || !currentVisible) {
        const first = runPage.items[0]
        if (first) {
          selectRun(first.id)
        } else {
          setSelectedRunId(null)
          setSelectedRun(null)
          setItems([])
          setItemsTotal(0)
          setRunLoading(false)
          setItemsLoading(false)
        }
      }
    } catch (loadError: unknown) {
      setRunsError(errorMessage(loadError, '评测任务加载失败'))
    } finally {
      setRunsLoading(false)
    }
  }

  const handleCreated = (run: EvaluationRun) => {
    setCreateOpen(false)
    setRuns((current) => [
      run,
      ...current.filter((item) => item.id !== run.id),
    ].slice(0, RUN_PAGE_SIZE))
    setRunsTotal((current) => current + 1)
    setSelectedRunId(run.id)
    setSelectedRun(run)
    setItems([])
    setItemsTotal(0)
    setItemsPage(1)
    setBadCaseOnly(false)
    setCategory('')
    setRunLoading(true)
    setItemsLoading(true)
    setRunError(null)
    setItemsError(null)
  }

  const handleDeleteRun = async (run: EvaluationRunListItem) => {
    const confirmed = window.confirm(
      `确定删除评测任务「${run.name}」吗？\n任务下的全部 case 明细会一并删除。`,
    )
    if (!confirmed) {
      return
    }

    try {
      await deleteEvaluationRun(run.id)
      const remaining = runs.filter((item) => item.id !== run.id)
      setRuns(remaining)
      setRunsTotal((current) => Math.max(0, current - 1))

      if (selectedRunId === run.id) {
        const next = remaining[0]
        if (next) {
          selectRun(next.id)
        } else {
          setSelectedRunId(null)
          setSelectedRun(null)
          setItems([])
          setItemsTotal(0)
          setRunLoading(false)
          setItemsLoading(false)
          if (runsPage > 1) {
            void loadRunPage(runsPage - 1, true)
          }
        }
      }
    } catch (deleteError: unknown) {
      setRunsError(errorMessage(deleteError, '删除评测任务失败'))
    }
  }

  const handleItemUpdated = (updated: EvaluationItem) => {
    setItems((current) => {
      const next = current.map((item) =>
        item.id === updated.id ? updated : item,
      )
      if (badCaseOnly && !updated.is_bad_case) {
        return next.filter((item) => item.id !== updated.id)
      }
      return next
    })
    setDetailItem(null)
  }

  const handleRefresh = () => {
    void loadRunPage(runsPage)
    if (selectedRunId) {
      setItemsLoading(true)
      setRunLoading(true)
    }
  }

  return (
    <main className="evaluations-page">
      <section className="evaluations-hero" aria-labelledby="evaluations-title">
        <div>
          <p className="eyebrow">
            <span className="eyebrow__mark" aria-hidden="true" />
            EVALUATION LAB
          </p>
          <h1 id="evaluations-title">
            RAG 评测
            <br />
            <span>质量实验室</span>
          </h1>
          <p className="hero__lead">
            用固定数据集回归检索与生成链路，观察 RAGAS 指标、引用命中、拒答准确率与延迟变化。
            每个 case 都保留实际回答、调试快照和 Bad Case 归因，方便定位下一轮优化方向。
          </p>
          <div className="evaluations-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon className="icon" />
              发起评测
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={handleRefresh}
              disabled={runsLoading}
            >
              <RefreshIcon
                className={runsLoading ? 'icon icon--spinning' : 'icon'}
              />
              刷新
            </button>
          </div>
        </div>

        <aside className="evaluations-summary" aria-label="评测概览">
          <span className="evaluations-summary__eyebrow">RUN SUMMARY</span>
          <div className="evaluations-summary__numbers">
            <div>
              <strong>{runsTotal}</strong>
              <span>评测任务</span>
            </div>
            <div>
              <strong>{datasets.length}</strong>
              <span>可用评测集</span>
            </div>
            <div>
              <strong>
                {completedRuns}
                <small>/{runs.length || 0}</small>
              </strong>
              <span>本页已完成</span>
            </div>
          </div>
          <div className="evaluations-summary__datasets">
            {datasets.length > 0 ? (
              datasets.slice(0, 4).map((dataset) => (
                <span key={dataset.name}>
                  {dataset.name}
                  <i>{dataset.size} 条</i>
                </span>
              ))
            ) : (
              <span>暂无可评测数据集</span>
            )}
          </div>
        </aside>
      </section>

      {runsError ? (
        <div className="evaluations-error" role="alert">
          <AlertIcon className="icon" />
          <p>{runsError}</p>
        </div>
      ) : null}

      <section className="evaluations-layout">
        <aside className="evaluations-rail">
          <header className="evaluations-rail__head">
            <div>
              <span className="evaluations-rail__eyebrow">RUN HISTORY</span>
              <h2>评测任务</h2>
            </div>
            <span className="evaluations-rail__count">{runsTotal}</span>
          </header>

          {runsLoading && runs.length === 0 ? (
            <div className="evaluations-skeleton" aria-label="评测任务加载中">
              <span />
              <span />
              <span />
            </div>
          ) : runs.length === 0 ? (
            <div className="evaluations-empty evaluations-empty--rail">
              <EvaluationIcon className="icon" />
              <p>还没有评测任务。</p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setCreateOpen(true)}
              >
                发起第一轮评测
              </button>
            </div>
          ) : (
            <div className="evaluations-runs">
              {runs.map((run) => {
                const overall = getRunOverallScore(run)
                return (
                  <div
                    className={`evaluations-run ${
                      run.id === selectedRunId ? 'is-active' : ''
                    }`}
                    key={run.id}
                  >
                    <button
                      type="button"
                      className="evaluations-run__select"
                      onClick={() => selectRun(run.id)}
                      aria-current={
                        run.id === selectedRunId ? 'true' : undefined
                      }
                    >
                      <span className="evaluations-run__topline">
                        <RunStatus status={run.status} />
                        <span>{formatDateTime(run.created_at)}</span>
                      </span>
                      <strong>{run.name}</strong>
                      <span className="evaluations-run__meta">
                        <span>{run.dataset_name}</span>
                        <span>{run.dataset_size} 条</span>
                        <span>
                          {formatProgress(
                            run.progress_completed,
                            run.progress_total,
                          )}
                        </span>
                      </span>
                      <span className="evaluations-run__progress">
                        <i
                          style={{
                            width: `${progressPercent(
                              run.progress_completed,
                              run.progress_total,
                            )}%`,
                          }}
                        />
                      </span>
                      <span className="evaluations-run__footer">
                        <span>
                          综合分{' '}
                          <strong>{formatEvaluationScore(overall, 3)}</strong>
                        </span>
                        <span>{run.progress_failed} 条失败</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="evaluations-run__delete"
                      onClick={() => void handleDeleteRun(run)}
                      aria-label={`删除评测任务 ${run.name}`}
                      title="删除评测任务"
                    >
                      <TrashIcon className="icon" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {runTotalPages > 1 ? (
            <div className="evaluations-pager">
              <button
                type="button"
                onClick={() => void loadRunPage(runsPage - 1, true)}
                disabled={runsPage <= 1 || runsLoading}
              >
                上一页
              </button>
              <span>
                {runsPage} / {runTotalPages}
              </span>
              <button
                type="button"
                onClick={() => void loadRunPage(runsPage + 1, true)}
                disabled={runsPage >= runTotalPages || runsLoading}
              >
                下一页
              </button>
            </div>
          ) : null}
        </aside>

        <section className="evaluations-main" aria-labelledby="run-detail-title">
          {!selectedRunId && !runLoading ? (
            <div className="evaluations-empty evaluations-empty--main">
              <EvaluationIcon className="icon" />
              <h2>选择一条评测任务</h2>
              <p>
                从左侧选择一个 run 查看指标与 case 明细，或发起新一轮评测。
              </p>
            </div>
          ) : runLoading && !selectedRun ? (
            <div className="evaluations-detail-loading">
              <Spinner label="正在加载评测详情" />
              <span>正在读取指标与 case 明细…</span>
            </div>
          ) : selectedRun ? (
            <>
              <header className="evaluations-detail-head">
                <div>
                  <div className="evaluations-detail-head__eyebrow">
                    <span>RUN DETAIL</span>
                    <RunStatus status={selectedRun.status} />
                  </div>
                  <h2 id="run-detail-title">{selectedRun.name}</h2>
                  <p>
                    数据集 <strong>{selectedRun.dataset_name}</strong> ·{' '}
                    {selectedRun.dataset_size} 条用例 · 创建于{' '}
                    {formatDateTime(selectedRun.created_at)}
                  </p>
                </div>
                <div className="evaluations-detail-head__stats">
                  <span>
                    进度
                    <strong>
                      {formatProgress(
                        selectedRun.progress_completed,
                        selectedRun.progress_total,
                      )}
                    </strong>
                  </span>
                  <span>
                    总耗时
                    <strong>{formatRunDuration(selectedRun)}</strong>
                  </span>
                  <span>
                    失败
                    <strong>{selectedRun.progress_failed}</strong>
                  </span>
                </div>
              </header>

              <div
                className="evaluations-progress"
                role="progressbar"
                aria-label="评测进度"
                aria-valuemin={0}
                aria-valuemax={selectedRun.progress_total}
                aria-valuenow={selectedRun.progress_completed}
              >
                <i
                  style={{
                    width: `${progressPercent(
                      selectedRun.progress_completed,
                      selectedRun.progress_total,
                    )}%`,
                  }}
                />
              </div>

              {selectedRun.error_message ? (
                <div className="evaluations-error" role="alert">
                  <AlertIcon className="icon" />
                  <p>{selectedRun.error_message}</p>
                </div>
              ) : null}

              <div className="evaluations-metrics">
                {EVALUATION_METRICS.map((metric) => (
                  <MetricCard
                    key={metric.key}
                    label={metric.label}
                    caption={metric.caption}
                    description={metric.description}
                    value={selectedRun[metric.key]}
                  />
                ))}
              </div>

              <div className="evaluations-perf">
                <span>
                  <small>平均总耗时</small>
                  <strong>{formatLatency(selectedRun.avg_latency_ms)}</strong>
                </span>
                <span>
                  <small>平均首 Token</small>
                  <strong>
                    {formatLatency(selectedRun.avg_first_token_latency_ms)}
                  </strong>
                </span>
                <span>
                  <small>Bad Case</small>
                  <strong>
                    {
                      items.filter((item) => item.is_bad_case).length
                    }
                  </strong>
                </span>
                <span>
                  <small>当前页 Case</small>
                  <strong>{items.length}</strong>
                </span>
              </div>

              {runError ? (
                <div className="evaluations-error" role="alert">
                  <AlertIcon className="icon" />
                  <p>{runError}</p>
                </div>
              ) : null}

              <div className="evaluations-items-head">
                <div>
                  <span className="evaluations-rail__eyebrow">CASE INSPECTOR</span>
                  <h3>评测明细</h3>
                  <p>
                    共 {itemsTotal} 条 · 第 {itemsPage} / {itemTotalPages} 页
                  </p>
                </div>
                <div className="evaluations-filters">
                  <label className="evaluations-toggle">
                    <input
                      type="checkbox"
                      checked={badCaseOnly}
                      onChange={(event) => {
                        setBadCaseOnly(event.target.checked)
                        setItemsPage(1)
                        setItemsLoading(true)
                      }}
                    />
                    <span>只看 Bad Case</span>
                  </label>
                  <select
                    value={category}
                    onChange={(event) => {
                      setCategory(
                        event.target.value as BadCaseCategoryValue | '',
                      )
                      setItemsPage(1)
                      setItemsLoading(true)
                    }}
                    aria-label="按 Bad Case 归因筛选"
                  >
                    <option value="">全部归因</option>
                    {BAD_CASE_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {itemsError ? (
                <div className="evaluations-error" role="alert">
                  <AlertIcon className="icon" />
                  <p>{itemsError}</p>
                </div>
              ) : null}

              {itemsLoading && items.length === 0 ? (
                <div className="evaluations-items-skeleton">
                  <span />
                  <span />
                  <span />
                </div>
              ) : items.length === 0 ? (
                <div className="evaluations-empty evaluations-empty--items">
                  <p>当前筛选条件下没有评测 case。</p>
                </div>
              ) : (
                <div className="evaluations-items">
                  {items.map((item) => (
                    <button
                      type="button"
                      className="evaluations-case"
                      key={item.id}
                      onClick={() => setDetailItem(item)}
                    >
                      <span className="evaluations-case__topline">
                        <span className="evaluations-case__id">
                          {item.case_id}
                        </span>
                        {item.is_bad_case ? (
                          <span className="evaluations-case__bad">
                            Bad Case
                            {item.bad_case_category
                              ? ` · ${BAD_CASE_CATEGORY_META[item.bad_case_category]}`
                              : ''}
                          </span>
                        ) : (
                          <span className="evaluations-case__good">正常</span>
                        )}
                        {item.actual_refused ? (
                          <span className="evaluations-case__muted">拒答</span>
                        ) : null}
                        <span className="evaluations-case__latency">
                          {formatLatency(item.latency_ms)}
                        </span>
                      </span>
                      <strong>{item.question}</strong>
                      <span className="evaluations-case__answer">
                        {item.actual_answer || '—'}
                      </span>
                      <span className="evaluations-case__scores">
                        <span>忠实度 {formatEvaluationScore(item.faithfulness, 2)}</span>
                        <span>相关性 {formatEvaluationScore(item.answer_relevancy, 2)}</span>
                        <span>精确率 {formatEvaluationScore(item.context_precision, 2)}</span>
                        <span>召回率 {formatEvaluationScore(item.context_recall, 2)}</span>
                        <span>引用 {item.citation_hit === null ? '—' : item.citation_hit ? '命中' : '未命中'}</span>
                      </span>
                      <ChevronRightIcon className="evaluations-case__chevron" />
                    </button>
                  ))}
                </div>
              )}

              {itemTotalPages > 1 ? (
                <div className="evaluations-pager evaluations-pager--items">
                  <button
                    type="button"
                    onClick={() => {
                      setItemsPage((page) => Math.max(1, page - 1))
                      setItemsLoading(true)
                    }}
                    disabled={itemsPage <= 1 || itemsLoading}
                  >
                    上一页
                  </button>
                  <span>
                    {itemsPage} / {itemTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setItemsPage((page) => page + 1)
                      setItemsLoading(true)
                    }}
                    disabled={itemsPage >= itemTotalPages || itemsLoading}
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="evaluations-empty evaluations-empty--main">
              <AlertIcon className="icon" />
              <h2>评测详情不可用</h2>
              <p>{runError || '暂时无法读取这条评测任务。'}</p>
            </div>
          )}
        </section>
      </section>

      {createOpen ? (
        <EvaluationCreateDialog
          datasets={datasets}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}

      {detailItem ? (
        <EvaluationItemDetail
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onUpdated={handleItemUpdated}
        />
      ) : null}
    </main>
  )
}
