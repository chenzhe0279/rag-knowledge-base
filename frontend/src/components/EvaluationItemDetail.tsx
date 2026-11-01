import { useState } from 'react'
import type { FormEvent } from 'react'
import { updateEvaluationItem } from '../api/evaluations'
import {
  BAD_CASE_CATEGORY_META,
  BAD_CASE_CATEGORY_OPTIONS,
  formatEvaluationScore,
  formatLatency,
  scorePercent,
} from '../lib/evaluations'
import { formatDateTime } from '../lib/format'
import type {
  BadCaseCategoryValue,
  EvaluationItem,
} from '../types/evaluations'
import { AlertIcon, CloseIcon } from './Icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'

interface EvaluationItemDetailProps {
  item: EvaluationItem
  onClose: () => void
  onUpdated: (item: EvaluationItem) => void
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="evaluation-json">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function MetricChip({
  label,
  value,
}: {
  label: string
  value: number | null | undefined
}) {
  const percent = scorePercent(value)
  return (
    <span className="evaluation-metric-chip">
      <span>{label}</span>
      <strong>{formatEvaluationScore(value, 3)}</strong>
      <i style={{ width: `${percent ?? 0}%` }} />
    </span>
  )
}

export function EvaluationItemDetail({
  item,
  onClose,
  onUpdated,
}: EvaluationItemDetailProps) {
  const [isBadCase, setIsBadCase] = useState(item.is_bad_case)
  const [category, setCategory] = useState<BadCaseCategoryValue | ''>(
    item.bad_case_category ?? '',
  )
  const [note, setNote] = useState(item.bad_case_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const updated = await updateEvaluationItem(item.id, {
        is_bad_case: isBadCase,
        bad_case_category: category || null,
        bad_case_note: note.trim() || null,
      })
      onUpdated(updated)
      onClose()
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : '保存 Bad Case 归因失败',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      labelledBy="evaluation-item-title"
      className="evaluation-detail-modal"
      closeDisabled={saving}
      onClose={onClose}
    >
      <article className="evaluation-detail">
        <header className="evaluation-detail__head">
          <div>
            <span className="evaluation-detail__eyebrow">
              EVALUATION CASE · {item.case_id}
            </span>
            <h2 id="evaluation-item-title">{item.question}</h2>
            <div className="evaluation-detail__meta">
              <span
                className={`evaluation-status evaluation-status--${
                  item.actual_refused ? 'failed' : 'completed'
                }`}
              >
                {item.actual_refused ? '实际拒答' : '实际回答'}
              </span>
              {item.is_bad_case ? (
                <span className="evaluation-badges__bad">
                  Bad Case
                  {item.bad_case_category
                    ? ` · ${BAD_CASE_CATEGORY_META[item.bad_case_category]}`
                    : ''}
                </span>
              ) : null}
              {item.tags.map((tag) => (
                <span className="evaluation-tag" key={tag}>
                  {tag}
                </span>
              ))}
              <span className="evaluation-tag">
                {formatDateTime(item.created_at)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="evaluation-detail__close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="evaluation-detail__metrics">
          <MetricChip label="忠实度" value={item.faithfulness} />
          <MetricChip label="答案相关性" value={item.answer_relevancy} />
          <MetricChip label="上下文精确率" value={item.context_precision} />
          <MetricChip label="上下文召回率" value={item.context_recall} />
          <span className="evaluation-detail__stat">
            <small>引用命中</small>
            <strong>
              {item.citation_hit === null
                ? '—'
                : item.citation_hit
                  ? '命中'
                  : '未命中'}
            </strong>
          </span>
          <span className="evaluation-detail__stat">
            <small>拒答判定</small>
            <strong>{item.refusal_correct ? '正确' : '错误'}</strong>
          </span>
          <span className="evaluation-detail__stat">
            <small>总耗时</small>
            <strong>{formatLatency(item.latency_ms)}</strong>
          </span>
          <span className="evaluation-detail__stat">
            <small>首 Token</small>
            <strong>{formatLatency(item.first_token_latency_ms)}</strong>
          </span>
        </div>

        {item.error_message ? (
          <div className="evaluation-detail__error" role="alert">
            <AlertIcon className="icon" />
            <p>{item.error_message}</p>
          </div>
        ) : null}

        <div className="evaluation-detail__answers">
          <section>
            <span className="evaluation-detail__label">参考答案</span>
            <p>{item.expected_answer || '—'}</p>
          </section>
          <section>
            <span className="evaluation-detail__label">系统实际回答</span>
            <p>{item.actual_answer || '—'}</p>
          </section>
        </div>

        <div className="evaluation-detail__expectations">
          <div>
            <span className="evaluation-detail__label">期望文档</span>
            <div className="evaluation-chip-list">
              {item.expected_document_names.length > 0 ? (
                item.expected_document_names.map((name) => (
                  <span className="evaluation-tag" key={name}>
                    {name}
                  </span>
                ))
              ) : (
                <span className="evaluation-detail__muted">—</span>
              )}
            </div>
          </div>
          <div>
            <span className="evaluation-detail__label">期望关键词</span>
            <div className="evaluation-chip-list">
              {item.expected_keywords.length > 0 ? (
                item.expected_keywords.map((keyword) => (
                  <span className="evaluation-tag" key={keyword}>
                    {keyword}
                  </span>
                ))
              ) : (
                <span className="evaluation-detail__muted">—</span>
              )}
            </div>
          </div>
        </div>

        {item.citations.length > 0 ? (
          <details className="evaluation-detail__details" open>
            <summary>引用片段 · {item.citations.length}</summary>
            <ol className="evaluation-citation-list">
              {item.citations.map((citation, index) => (
                <li key={citation.id ?? `${citation.ordinal ?? index}`}>
                  <span className="evaluation-citation-list__index">
                    [{citation.ordinal ?? index + 1}]
                  </span>
                  <div>
                    <strong>
                      {citation.document_name ?? '未知文档'}
                      {citation.page_no ? ` · p.${citation.page_no}` : ''}
                    </strong>
                    <p>{citation.quote ?? '—'}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        {item.retrieved_chunks_meta.length > 0 ? (
          <details className="evaluation-detail__details">
            <summary>
              检索片段元数据 · {item.retrieved_chunks_meta.length}
            </summary>
            <div className="evaluation-chunk-list">
              {item.retrieved_chunks_meta.map((chunk, index) => (
                <div className="evaluation-chunk" key={chunk.chunk_id ?? index}>
                  <div className="evaluation-chunk__head">
                    <strong>
                      {chunk.document_name ?? '未知文档'}
                      {chunk.page_no ? ` · p.${chunk.page_no}` : ''}
                    </strong>
                    <span>
                      V {formatEvaluationScore(chunk.vector_score, 3)} · R{' '}
                      {formatEvaluationScore(chunk.rerank_score, 3)}
                    </span>
                  </div>
                  <p>{chunk.content ?? '—'}</p>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {item.query_route || item.agent_steps || item.verify_result ? (
          <details className="evaluation-detail__details">
            <summary>调试快照</summary>
            <div className="evaluation-snapshots">
              {item.query_route ? (
                <div>
                  <span className="evaluation-detail__label">Query Route</span>
                  <JsonBlock value={item.query_route} />
                </div>
              ) : null}
              {item.agent_steps ? (
                <div>
                  <span className="evaluation-detail__label">Agent Steps</span>
                  <JsonBlock value={item.agent_steps} />
                </div>
              ) : null}
              {item.verify_result ? (
                <div>
                  <span className="evaluation-detail__label">Verify Result</span>
                  <JsonBlock value={item.verify_result} />
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        <form className="evaluation-bad-case" onSubmit={save}>
          <header>
            <div>
              <span className="evaluation-detail__label">Bad Case 归因</span>
              <p>人工覆盖自动归因，保存后会持久化到当前评测明细。</p>
            </div>
            <label className="evaluation-switch">
              <input
                type="checkbox"
                checked={isBadCase}
                onChange={(event) => setIsBadCase(event.target.checked)}
                disabled={saving}
              />
              <span>标记为 Bad Case</span>
            </label>
          </header>

          <div className="evaluation-bad-case__fields">
            <label className="evaluation-field">
              <span>错误分类</span>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as BadCaseCategoryValue | '')
                }
                disabled={saving || !isBadCase}
              >
                <option value="">未分类</option>
                {BAD_CASE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="evaluation-field evaluation-field--note">
              <span>人工备注</span>
              <textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="记录排查结论、修复建议或误判原因…"
                disabled={saving}
              />
            </label>
          </div>

          {error ? (
            <p className="evaluation-create__error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="evaluation-bad-case__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={onClose}
              disabled={saving}
            >
              关闭
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={saving}
            >
              {saving ? <Spinner small label="正在保存" /> : null}
              {saving ? '保存中…' : '保存归因'}
            </button>
          </footer>
        </form>
      </article>
    </Modal>
  )
}
