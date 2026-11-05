import { DOCUMENT_STATUS_META, TASK_STATUS_META, type Tone } from '../lib/documents'
import type { DocumentStatus, IngestionTaskStatus } from '../types/api'

interface StatusBadgeProps {
  tone: Tone
  label: string
  /** 运行中/排队中才使用呼吸圆点。 */
  live?: boolean
  className?: string
}

/** 圆点 + 文字的状态徽标，不只依赖颜色传达状态。 */
export function StatusBadge({ tone, label, live = false, className }: StatusBadgeProps) {
  return (
    <span className={className ? `badge ${className}` : 'badge'} data-tone={tone}>
      <span className={live ? 'dot dot--live' : 'dot'} aria-hidden="true" />
      {label}
    </span>
  )
}

export function DocumentStatusBadge({
  status,
  className,
}: {
  status: DocumentStatus
  className?: string
}) {
  const meta = DOCUMENT_STATUS_META[status]
  return <StatusBadge tone={meta.tone} label={meta.label} live={meta.live} className={className} />
}

export function TaskStatusBadge({ status }: { status: IngestionTaskStatus }) {
  const meta = TASK_STATUS_META[status]
  return <StatusBadge tone={meta.tone} label={meta.label} live={meta.live} />
}
