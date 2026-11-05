import { ChevronLeftIcon, ChevronRightIcon } from './Icons'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  disabled?: boolean
  /** 计数单位，例如“个文档”。 */
  unit?: string
}

export function Pagination({ page, pageSize, total, onChange, disabled, unit = '条' }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize && page <= 1) return null
  return (
    <nav className="pagination" aria-label="分页">
      <span>
        共 <span className="num">{total}</span> {unit}
      </span>
      <div className="pagination__controls">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onChange(page - 1)}
          disabled={disabled || page <= 1}
          aria-label="上一页"
        >
          <ChevronLeftIcon size={14} />
          上一页
        </button>
        <span className="pagination__page" aria-current="page">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onChange(page + 1)}
          disabled={disabled || page >= pageCount}
          aria-label="下一页"
        >
          下一页
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </nav>
  )
}
