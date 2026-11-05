import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { listDocuments } from '../../api/documents'
import { errorMessage, isAbortError } from '../../api/http'
import { AlertIcon, CloseIcon, InfoIcon } from '../../components/Icons'
import { Modal } from '../../components/Modal'
import { Pagination } from '../../components/Pagination'
import { ErrorState, Skeleton } from '../../components/States'
import { FILE_KIND_LABEL, FILTERABLE_MIME_TYPES, fileKindFromMime } from '../../lib/documents'
import { formatDate } from '../../lib/format'
import type { DocumentRead, Page } from '../../types/api'
import { EMPTY_FILTERS, FILTER_MAX_DOCUMENTS, validateFilters, type FilterDraft } from './chatModel'

const DOC_PAGE_SIZE = 8

interface ChatFilterDialogProps {
  value: FilterDraft
  onClose: () => void
  onApply: (next: FilterDraft) => void
}

/** 检索过滤：文件类型 / 上传时间 / 指定文档，对应后端 RetrievalFilters。始终打开，按需挂载。 */
export function ChatFilterDialog({ value, onClose, onApply }: ChatFilterDialogProps) {
  const [draft, setDraft] = useState<FilterDraft>(value)
  const [error, setError] = useState<string | null>(null)

  function toggleMime(mime: string) {
    setDraft((current) => ({
      ...current,
      mimeTypes: current.mimeTypes.includes(mime)
        ? current.mimeTypes.filter((item) => item !== mime)
        : [...current.mimeTypes, mime],
    }))
  }

  function toggleDocument(doc: DocumentRead) {
    setDraft((current) => {
      const exists = current.documents.some((item) => item.id === doc.id)
      if (exists) return { ...current, documents: current.documents.filter((item) => item.id !== doc.id) }
      if (current.documents.length >= FILTER_MAX_DOCUMENTS) return current
      return { ...current, documents: [...current.documents, { id: doc.id, name: doc.name }] }
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = validateFilters(draft)
    if (message) {
      setError(message)
      return
    }
    onApply(draft)
  }

  return (
    <Modal
      open
      size="lg"
      eyebrow="Retrieval filters"
      title="检索过滤"
      description="限定本次问答的检索范围。过滤只作用于检索阶段，权限标签依旧生效。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => setDraft(EMPTY_FILTERS)}>
            清空条件
          </button>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" form="chat-filter-form" className="btn btn--primary">
            应用过滤
          </button>
        </>
      }
    >
      <form id="chat-filter-form" className="chat-filter" onSubmit={handleSubmit} noValidate>
        <fieldset className="chat-filter__group">
          <legend className="field__label">文件类型</legend>
          <div className="segmented chat-filter__mimes">
            {FILTERABLE_MIME_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.mimeTypes.includes(option.value)}
                onClick={() => toggleMime(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="field__hint">不选表示不限类型。</p>
        </fieldset>

        <fieldset className="chat-filter__group">
          <legend className="field__label">上传时间</legend>
          <div className="form-grid">
            <label className="field">
              <span className="field__hint">开始日期</span>
              <input
                type="date"
                className="input"
                value={draft.createdFrom}
                max={draft.createdTo || undefined}
                onChange={(event) => {
                  setError(null)
                  setDraft((current) => ({ ...current, createdFrom: event.target.value }))
                }}
              />
            </label>
            <label className="field">
              <span className="field__hint">结束日期</span>
              <input
                type="date"
                className="input"
                value={draft.createdTo}
                min={draft.createdFrom || undefined}
                onChange={(event) => {
                  setError(null)
                  setDraft((current) => ({ ...current, createdTo: event.target.value }))
                }}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="chat-filter__group">
          <legend className="field__label">
            指定文档
            <span className="faint num">
              {' '}
              {draft.documents.length} / {FILTER_MAX_DOCUMENTS}
            </span>
          </legend>
          {draft.documents.length ? (
            <ul className="chip-list chat-filter__selected">
              {draft.documents.map((doc) => (
                <li key={doc.id}>
                  <span className="chip chip--accent">
                    <span className="chat-filter__chip-name">{doc.name}</span>
                    <button
                      type="button"
                      className="chat-filter__chip-remove"
                      aria-label={`移除 ${doc.name}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          documents: current.documents.filter((item) => item.id !== doc.id),
                        }))
                      }
                    >
                      <CloseIcon size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field__hint">不选表示检索全部可见文档。</p>
          )}
          <DocumentPicker selected={draft.documents} onToggle={toggleDocument} />
        </fieldset>

        {error ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={15} />
              {error}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}

function DocumentPicker({
  selected,
  onToggle,
}: {
  selected: FilterDraft['documents']
  onToggle: (doc: DocumentRead) => void
}) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<DocumentRead> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    try {
      // 只有 ready 状态的文档会进入检索
      const result = await listDocuments({ page, pageSize: DOC_PAGE_SIZE, status: 'ready' }, controller.signal)
      setData(result)
      setError(null)
    } catch (caught) {
      if (isAbortError(caught)) return
      setError(errorMessage(caught, '文档列表加载失败'))
    } finally {
      if (controllerRef.current === controller) setLoading(false)
    }
  }, [page])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [load])

  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  const selectedIds = new Set(selected.map((doc) => doc.id))
  const full = selected.length >= FILTER_MAX_DOCUMENTS

  return (
    <div className="doc-picker">
      {loading && !data ? (
        <div className="doc-picker__list">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={44} radius={12} />
          ))}
        </div>
      ) : data && data.items.length ? (
        <ul className="doc-picker__list" aria-busy={loading}>
          {data.items.map((doc) => {
            const checked = selectedIds.has(doc.id)
            return (
              <li key={doc.id}>
                <label className="doc-picker__item">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={() => onToggle(doc)}
                  />
                  <span className="doc-picker__name">{doc.name}</span>
                  <span className="doc-picker__meta">
                    {FILE_KIND_LABEL[fileKindFromMime(doc.mime_type)]} · {formatDate(doc.created_at)}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="inline-note">
          <InfoIcon size={15} />
          <p>暂无可检索的就绪文档。</p>
        </div>
      )}
      {data ? (
        <Pagination
          page={page}
          pageSize={DOC_PAGE_SIZE}
          total={data.total}
          onChange={setPage}
          disabled={loading}
          unit="个就绪文档"
        />
      ) : null}
    </div>
  )
}
