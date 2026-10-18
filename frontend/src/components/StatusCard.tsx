import type { HealthCheck, ServiceDefinition } from '../types/health'
import { formatLatency, formatTime } from '../lib/format'
import { presentHealth } from '../lib/healthPresentation'
import { RefreshIcon, ServiceIcon } from './Icons'

interface StatusCardProps {
  service: ServiceDefinition
  check: HealthCheck
  onRefresh: (service: ServiceDefinition) => void
}

export function StatusCard({ service, check, onRefresh }: StatusCardProps) {
  const status = presentHealth(check)
  const latency = formatLatency(check.latencyMs)
  const checkedAt = check.checkedAt ? formatTime(check.checkedAt) : null

  return (
    <article
      className="status-card"
      data-service={service.id}
      aria-labelledby={`service-${service.id}`}
      aria-busy={check.refreshing}
    >
      <div className="status-card__header">
        <span className="status-card__icon">
          <ServiceIcon name={service.icon} />
        </span>
        <span className={`status-badge status-badge--${status.tone}`}>
          <span className="status-badge__dot" aria-hidden="true" />
          {status.label}
        </span>
      </div>

      <div className="status-card__body">
        <span className="status-card__category">{service.category}</span>
        <h3 id={`service-${service.id}`}>{service.name}</h3>
        <p className="status-card__description">{service.description}</p>
      </div>

      <dl className="status-card__meta">
        <div>
          <dt>健康接口</dt>
          <dd>
            <code>{service.endpoint}</code>
          </dd>
        </div>
        <div>
          <dt>响应耗时</dt>
          <dd className="status-card__latency">{latency ?? '—'}</dd>
        </div>
      </dl>

      <p
        className={`status-card__message status-card__message--${status.tone}`}
        role="status"
        aria-live="polite"
      >
        {status.message}
      </p>

      <div className="status-card__footer">
        <span className="status-card__time">
          {checkedAt ? `检测于 ${checkedAt}` : '等待首次检测'}
        </span>
        <button
          type="button"
          className="refresh-button"
          onClick={() => onRefresh(service)}
          disabled={check.refreshing}
          aria-label={`重新检测${service.name}`}
        >
          <RefreshIcon
            className={check.refreshing ? 'icon icon--spinning' : 'icon'}
          />
          {check.refreshing ? '检测中' : '重新检测'}
        </button>
      </div>
    </article>
  )
}
