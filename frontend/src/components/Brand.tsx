import { BrandMark } from './Icons'
import './Brand.css'

interface BrandProps {
  title?: string
  subtitle?: string
  /** 只显示方形标识（启动屏等场景）。 */
  compact?: boolean
}

export function Brand({
  title = 'RAG Knowledge Base',
  subtitle = '知识库控制台',
  compact = false,
}: BrandProps) {
  return (
    <span className="brand">
      <span className="brand__mark">
        <BrandMark size={22} />
      </span>
      {compact ? null : (
        <span className="brand__text">
          <span className="brand__title">{title}</span>
          <span className="brand__subtitle">{subtitle}</span>
        </span>
      )}
    </span>
  )
}
