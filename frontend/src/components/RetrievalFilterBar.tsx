import {
  DOCUMENT_TYPE_OPTIONS,
  countActiveFilters,
  formatFilterSummary,
  getFilterDateError,
  type ChatFilters,
} from '../lib/retrievalFilters'

interface RetrievalFilterBarProps {
  value: ChatFilters
  onChange: (filters: ChatFilters) => void
  disabled?: boolean
}

/**
 * 检索范围过滤器。
 * 只负责收集“文档类型 + 上传时间范围”，真正的过滤在两条检索 SQL 里完成。
 * 条件会随每次提问通过 ChatRequest.filters 发送给后端。
 */
export function RetrievalFilterBar({
  value,
  onChange,
  disabled = false,
}: RetrievalFilterBarProps) {
  const activeCount = countActiveFilters(value)
  const dateError = getFilterDateError(value)

  const toggleType = (key: string) => {
    const selected = value.documentTypes.includes(key)
    onChange({
      ...value,
      documentTypes: selected
        ? value.documentTypes.filter((item) => item !== key)
        : [...value.documentTypes, key],
    })
  }

  return (
    <section
      className={`chat-filter-bar ${activeCount > 0 ? 'is-active' : ''}`}
      aria-label="检索范围过滤"
    >
      <div className="chat-filter-bar__head">
        <span className="chat-filter-bar__title">检索范围</span>
        <span className="chat-filter-bar__summary" title={formatFilterSummary(value)}>
          {formatFilterSummary(value)}
        </span>
        {activeCount > 0 ? (
          <button
            type="button"
            className="chat-filter-bar__clear"
            onClick={() => onChange({ documentTypes: [], createdFrom: '', createdTo: '' })}
            disabled={disabled}
          >
            清空
          </button>
        ) : null}
      </div>

      <div className="chat-filter-bar__controls">
        <div className="chat-filter-bar__types" role="group" aria-label="文档类型">
          {DOCUMENT_TYPE_OPTIONS.map((option) => {
            const selected = value.documentTypes.includes(option.key)

            return (
              <button
                key={option.key}
                type="button"
                className={`chat-filter-chip ${selected ? 'is-selected' : ''}`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => toggleType(option.key)}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="chat-filter-bar__dates">
          <label>
            <span>从</span>
            <input
              type="date"
              value={value.createdFrom}
              max={value.createdTo || undefined}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, createdFrom: event.target.value })
              }
            />
          </label>
          <span className="chat-filter-bar__dash">—</span>
          <label>
            <span>至</span>
            <input
              type="date"
              value={value.createdTo}
              min={value.createdFrom || undefined}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, createdTo: event.target.value })
              }
            />
          </label>
        </div>
      </div>

      {dateError ? (
        <p className="chat-filter-bar__error" role="alert">
          {dateError}
        </p>
      ) : null}
    </section>
  )
}
