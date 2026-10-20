import type { ReactNode } from 'react'

export type BadgeTone = 'success' | 'danger' | 'warning' | 'pending' | 'info'

interface StatusBadgeProps {
  tone: BadgeTone
  children: ReactNode
  pulse?: boolean
}

export function StatusBadge({ tone, children, pulse = false }: StatusBadgeProps) {
  return (
    <span
      className={`status-badge status-badge--${tone}${pulse ? ' status-badge--pulse' : ''}`}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {children}
    </span>
  )
}
