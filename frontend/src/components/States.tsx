import type { CSSProperties, ReactNode } from 'react'
import { AlertIcon, RefreshIcon } from './Icons'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h3 className="empty-state__title">{title}</h3>
      {description ? <p className="empty-state__desc">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({ message, onRetry, retryLabel = '重试' }: ErrorStateProps) {
  return (
    <div className="inline-error" role="alert">
      <span className="inline-error__text">
        <AlertIcon size={16} />
        {message}
      </span>
      {onRetry ? (
        <button type="button" className="btn btn--sm btn--danger-ghost" onClick={onRetry}>
          <RefreshIcon size={14} />
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}

export function Skeleton({
  height = 16,
  width = '100%',
  radius,
  className,
}: {
  height?: number | string
  width?: number | string
  radius?: number
  className?: string
}) {
  const style: CSSProperties = { height, width, borderRadius: radius }
  return (
    <div className={className ? `skeleton ${className}` : 'skeleton'} style={style} aria-hidden="true" />
  )
}

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <span className="spinner spinner--lg" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
