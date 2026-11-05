import { useCallback, useEffect, useRef, useState } from 'react'
import { getEvaluationItem, updateEvaluationItem } from '../../api/evaluations'
import { errorMessage, isAbortError } from '../../api/http'
import { Link } from '../../app/Link'
import { paths } from '../../app/router'
import {
  AgentIcon,
  AlertIcon,
  CheckCircleIcon,
  FileIcon,
  LayersIcon,
  RouteIcon,
} from '../../components/Icons'
import { MarkdownView } from '../../components/MarkdownView'
import { Modal } from '../../components/Modal'
import { ErrorState, Skeleton } from '../../components/States'
import { useToast } from '../../components/toast/useToast'
import { formatLatency, formatScore } from '../../lib/format'
import {
  AGENT_ACTION_LABEL,
  BAD_CASE_CATEGORIES,
  BAD_CASE_LABEL,
  QUERY_ROUTE_LABEL,
  scoreTone,
} from '../../lib/labels'
import type { BadCaseCategory, EvaluationItem } from '../../types/api'
import {
  ITEM_METRICS,
  parseAgentSteps,
  parseChunks,
  parseCitations,
  parseRoute,
  parseVerify,
} from './evalModel'

const NOTE_MAX = 2000

interface CaseDialogProps {
  itemId: string
  onClose: () => void
  onSaved: (item: EvaluationItem) => void
}

interface Draft {
  isBad: boolean
  category: BadCaseCategory | ''
  note: string
}

function draftFrom(item: EvaluationItem): Draft {
  return {
    isBad: item.is_bad_case,
    category: item.bad_case_category ?? '',
    note: item.bad_case_note ?? '',
  }
}

function sameDraft(a: Draft, b: Draft) {
  return a.isBad === b.isBad && a.category === b.category && a.note === b.note
}

/** 始终打开，由父组件按需挂载。 */
export function CaseDialog({ itemId, onClose, onSaved }: CaseDialogProps) {
  const toast = useToast()
  const [item, setItem] = useState<EvaluationItem | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ isBad: false, category: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoadError(null)
    try {
      const result = await getEvaluationItem(itemId, controller.signal)
      setItem(result)
      setDraft(draftFrom(result))
    } catch (caught) {
      if (isAbortError(caught)) return
      setLoadError(errorMessage(caught, '加载 case 详情失败'))
    }
  }, [itemId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [load])

  const dirty = item ? !sameDraft(draft, draftFrom(item)) : false

  async function save() {
    if (!item) return
    if (draft.note.length > NOTE_MAX) {
      setSaveError(`备注不能超过 ${NOTE_MAX} 个字符`)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      // 后端语义：is_bad_case=false 会清空分类；传入分类会同时标记为 Bad Case
      const payload = draft.isBad
        ? {
            is_bad_case: true,
            bad_case_category: draft.category || null,
            bad_case_note: draft.note.trim(),
          }
        : { is_bad_case: false, bad_case_note: draft.note.trim() }
      const updated = await updateEvaluationItem(item.id, payload)
      setItem(updated)
      setDraft(draftFrom(updated))
      onSaved(updated)
      toast.success('Bad Case 标注已保存')
    } catch (caught) {
      setSaveError(errorMessage(caught, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      eyebrow={item ? `Case · ${item.case_id}` : 'Evaluation case'}
      title={item ? item.question : '加载中…'}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            关闭
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void save()}
            disabled={!item || !dirty || saving}
          >
            {saving ? '正在保存…' : '保存标注'}
          </button>
        </>
      }
    >
      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !item ? (
        <div className="case-detail">
          <Skeleton height={68} radius={16} />
          <Skeleton height={160} radius={16} />
          <Skeleton height={120} radius={16} />
        </div>
      ) : (
        <CaseBody
          item={item}
          draft={draft}
          onDraft={(next) => {
            setDraft(next)
            setSaveError(null)
          }}
          saving={saving}
          saveError={saveError}
        />
      )}
    </Modal>
  )
}

function CaseBody({
  item,
  draft,
  onDraft,
  saving,
  saveError,
}: {
  item: EvaluationItem
  draft: Draft
  onDraft: (draft: Draft) => void
  saving: boolean
  saveError: string | null
}) {
  const citations = parseCitations(item.citations)
  const chunks = parseChunks(item.retrieved_chunks_meta)
  const route = parseRoute(item.query_route)
  const steps = parseAgentSteps(item.agent_steps)
  const verify = parseVerify(item.verify_result)

  return (
    <div className="case-detail">
      <div className="case-metrics">
        {ITEM_METRICS.map((metric) => (
          <div key={metric.key} className="case-metric" data-tone={scoreTone(item[metric.key])}>
            <span>{metric.label}</span>
            <strong className="num">{formatScore(item[metric.key])}</strong>
          </div>
        ))}
        <div className="case-metric" data-tone={item.citation_hit === null || item.citation_hit === undefined ? 'pending' : item.citation_hit ? 'success' : 'danger'}>
          <span>引用命中</span>
          <strong>
            {item.citation_hit === null || item.citation_hit === undefined
              ? '—'
              : item.citation_hit
                ? '命中'
                : '未命中'}
          </strong>
        </div>
        <div className="case-metric" data-tone={item.refusal_correct ? 'success' : 'danger'}>
          <span>拒答判断</span>
          <strong>{item.refusal_correct ? '正确' : '错误'}</strong>
        </div>
      </div>

      <dl className="facts case-facts">
        <div>
          <dt>应拒答</dt>
          <dd>{item.should_refuse ? '是' : '否'}</dd>
        </div>
        <div>
          <dt>实际拒答</dt>
          <dd>{item.actual_refused ? '是' : '否'}</dd>
        </div>
        <div>
          <dt>总耗时</dt>
          <dd className="num">{formatLatency(item.latency_ms)}</dd>
        </div>
        <div>
          <dt>首 token</dt>
          <dd className="num">{formatLatency(item.first_token_latency_ms)}</dd>
        </div>
        <div>
          <dt>Trace</dt>
          <dd className="mono">{item.trace_id ?? '—'}</dd>
        </div>
      </dl>

      {item.error_message ? (
        <div className="inline-error" role="alert">
          <span className="inline-error__text">
            <AlertIcon size={15} />
            执行出错：{item.error_message}
          </span>
        </div>
      ) : null}

      <div className="case-answers">
        <section className="case-answer">
          <header>
            <span className="eyebrow">Expected</span>
            <h3>期望答案</h3>
          </header>
          <MarkdownView content={item.expected_answer || '（未提供期望答案）'} />
          {item.expected_document_names?.length || item.expected_keywords?.length ? (
            <div className="case-answer__meta">
              {item.expected_document_names?.map((name) => (
                <span key={`d-${name}`} className="chip chip--accent">
                  <FileIcon size={11} />
                  {name}
                </span>
              ))}
              {item.expected_keywords?.map((keyword) => (
                <span key={`k-${keyword}`} className="chip">
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
        </section>
        <section className="case-answer case-answer--actual">
          <header>
            <span className="eyebrow">Actual</span>
            <h3>实际答案</h3>
            {item.actual_refused ? (
              <span className="badge" data-tone="warning">
                拒答
              </span>
            ) : null}
          </header>
          <MarkdownView content={item.actual_answer || '（无输出）'} />
          {verify ? (
            <p className="case-verify" data-verified={verify.verified}>
              {verify.verified ? <CheckCircleIcon size={14} /> : <AlertIcon size={14} />}
              {verify.verified ? '答案校验通过' : '答案校验未通过'}
              {verify.reason ? `：${verify.reason}` : ''}
            </p>
          ) : null}
        </section>
      </div>

      {citations.length ? (
        <section className="case-section">
          <h3 className="case-section__title">
            <FileIcon size={15} />
            引用 · {citations.length}
          </h3>
          <ol className="case-cites">
            {citations.map((citation) => (
              <li key={citation.key}>
                <div className="case-cites__head">
                  <span className="num case-cites__ordinal">[{citation.ordinal ?? '?'}]</span>
                  {citation.documentId ? (
                    <Link to={paths.document(citation.documentId)} className="case-doc-link">
                      {citation.documentName}
                    </Link>
                  ) : (
                    <strong>{citation.documentName}</strong>
                  )}
                  {citation.pageNo !== null ? <span className="chip">P{citation.pageNo}</span> : null}
                </div>
                {citation.quote ? <p className="clamp-2">{citation.quote}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {chunks.length ? (
        <details className="case-fold">
          <summary>
            <LayersIcon size={15} />
            召回 Chunks · {chunks.length}
          </summary>
          <ol className="case-chunks">
            {chunks.map((chunk, index) => (
              <li key={chunk.key}>
                <div className="case-chunks__head">
                  <span className="num">#{index + 1}</span>
                  <strong>{chunk.documentName}</strong>
                  {chunk.pageNo !== null ? <span className="chip">P{chunk.pageNo}</span> : null}
                  {chunk.sectionPath ? (
                    <span className="faint case-chunks__section">{chunk.sectionPath}</span>
                  ) : null}
                </div>
                <div className="case-chunks__scores num">
                  <span>向量 {formatScore(chunk.vectorScore)}</span>
                  <span>RRF {formatScore(chunk.rrfScore, 4)}</span>
                  <span>精排 {formatScore(chunk.rerankScore)}</span>
                </div>
                <p>{chunk.content}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {route ? (
        <details className="case-fold">
          <summary>
            <RouteIcon size={15} />
            检索路由
            <span className="chip chip--accent">{QUERY_ROUTE_LABEL[route.route]}</span>
          </summary>
          <dl className="case-kv">
            <div>
              <dt>原问题</dt>
              <dd>{route.query}</dd>
            </div>
            {route.rewritten_query ? (
              <div>
                <dt>改写后</dt>
                <dd>{route.rewritten_query}</dd>
              </div>
            ) : null}
            {route.hyde_answer ? (
              <div>
                <dt>HyDE</dt>
                <dd>{route.hyde_answer}</dd>
              </div>
            ) : null}
            {route.multi_queries?.length ? (
              <div>
                <dt>多查询</dt>
                <dd>
                  <ul>
                    {route.multi_queries.map((query, index) => (
                      <li key={`${index}-${query}`}>{query}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}

      {steps.length ? (
        <details className="case-fold">
          <summary>
            <AgentIcon size={15} />
            Agent 轨迹 · {steps.length} 步
          </summary>
          <ol className="case-steps">
            {steps.map((step, index) => (
              <li key={`${step.round}-${index}`}>
                <div className="case-steps__head">
                  <span className="num">R{step.round}</span>
                  <strong>{AGENT_ACTION_LABEL[step.action]}</strong>
                  <span className="chip">{QUERY_ROUTE_LABEL[step.route]}</span>
                  <span className="faint num">
                    召回 {step.retrieved_count ?? '—'} · 最高 {formatScore(step.top_score)}
                  </span>
                </div>
                {step.reason ? <p>{step.reason}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <section className="case-annotate" data-bad={draft.isBad}>
        <div className="case-annotate__head">
          <div>
            <span className="eyebrow">Bad case annotation</span>
            <h3>人工标注</h3>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.isBad}
              disabled={saving}
              onChange={(event) =>
                onDraft({
                  ...draft,
                  isBad: event.target.checked,
                  category: event.target.checked ? draft.category : '',
                })
              }
            />
            <span className="switch__track" aria-hidden="true" />
            <span>标记为 Bad Case</span>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">问题归因</span>
            <select
              className="select"
              value={draft.category}
              disabled={saving || !draft.isBad}
              onChange={(event) =>
                onDraft({ ...draft, category: event.target.value as BadCaseCategory | '' })
              }
            >
              <option value="">未分类</option>
              {BAD_CASE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {BAD_CASE_LABEL[category]}
                </option>
              ))}
            </select>
            <span className="field__hint">关闭 Bad Case 时后端会清空分类。</span>
          </label>
          <label className="field form-grid--full">
            <span className="field__label">备注</span>
            <textarea
              className="textarea"
              rows={3}
              value={draft.note}
              maxLength={NOTE_MAX}
              disabled={saving}
              placeholder="记录问题现象、定位结论或修复思路"
              onChange={(event) => onDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </div>
        {saveError ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={15} />
              {saveError}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  )
}
