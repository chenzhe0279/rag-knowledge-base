import { ExternalLinkIcon, RefreshIcon } from '../components/Icons'
import { StatusCard } from '../components/StatusCard'
import { API_DOCS_URL } from '../config'
import { SERVICES } from '../data/services'
import { useHealthChecks } from '../hooks/useHealthChecks'
import { formatTime } from '../lib/format'
import type { StatusTone } from '../lib/healthPresentation'
import type { HealthCheck } from '../types/health'
import './SystemStatusPage.css'

interface OverallHealth {
  tone: StatusTone
  label: string
  message: string
  okCount: number
  attentionCount: number
}

function summarizeHealth(checkList: HealthCheck[]): OverallHealth {
  const okCount = checkList.filter(
    (check) => check.phase === 'success' && check.response?.status === 'ok',
  ).length
  const attentionCount = checkList.filter(
    (check) =>
      check.phase === 'failure' ||
      (check.phase === 'success' && check.response?.status !== 'ok'),
  ).length
  const allSettled = checkList.every((check) => !check.refreshing)

  if (!allSettled) {
    return {
      tone: 'pending',
      label: '检测中',
      message: '正在并行检测三项依赖，请稍候…',
      okCount,
      attentionCount,
    }
  }

  if (attentionCount === 0) {
    return {
      tone: 'success',
      label: '全部正常',
      message: '所有依赖均已就绪，可以开始上传与检索文档。',
      okCount,
      attentionCount,
    }
  }

  if (okCount === 0) {
    return {
      tone: 'danger',
      label: '服务异常',
      message: '依赖服务暂不可用，请检查后端日志与配置。',
      okCount,
      attentionCount,
    }
  }

  return {
    tone: 'warning',
    label: '部分异常',
    message: `有 ${attentionCount} 项检查需要关注，其余服务运行正常。`,
    okCount,
    attentionCount,
  }
}

export function SystemStatusPage() {
  const { checks, refresh, refreshAll } = useHealthChecks(SERVICES)

  const checkList = SERVICES.map((service) => checks[service.id])
  const isChecking = checkList.some((check) => check.refreshing)
  const {
    tone: overallTone,
    label: overallLabel,
    message: summaryMessage,
    okCount,
    attentionCount,
  } = summarizeHealth(checkList)

  const lastCheckedAt = checkList.reduce<Date | null>((latest, check) => {
    if (!check.checkedAt) {
      return latest
    }
    return !latest || check.checkedAt > latest ? check.checkedAt : latest
  }, null)

  const progress = (okCount / SERVICES.length) * 100

  return (
    <main className="status-page">
      <section className="hero" aria-labelledby="status-page-title">
        <div className="hero__content">
          <p className="eyebrow">
            <span className="eyebrow__mark" aria-hidden="true" />
            SYSTEM HEALTH
          </p>
          <h1 id="status-page-title">
            知识库服务
            <br />
            <span>健康检查</span>
          </h1>
          <p className="hero__lead">
            一站式检查 FastAPI 后端、PostgreSQL 数据库与腾讯云 COS
            对象存储。每张卡片独立请求对应的健康接口，并实时反馈状态与耗时。
          </p>
          <div className="hero__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={refreshAll}
              disabled={isChecking}
            >
              <RefreshIcon
                className={isChecking ? 'icon icon--spinning' : 'icon'}
              />
              {isChecking ? '正在检测…' : '刷新全部'}
            </button>
            <a
              className="button button--ghost"
              href={API_DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon className="icon" />
              API 文档
            </a>
          </div>
        </div>

        <aside
          className={`summary summary--${overallTone}`}
          aria-labelledby="summary-title"
        >
          <div className="summary__header">
            <span id="summary-title">整体状态</span>
            <span
              className={`summary__badge summary__badge--${overallTone}`}
              role="status"
              aria-live="polite"
            >
              <span className="summary__dot" aria-hidden="true" />
              {overallLabel}
            </span>
          </div>

          <div className="summary__score">
            <strong>{okCount}</strong>
            <span>/{SERVICES.length}</span>
          </div>
          <p className="summary__caption">项依赖服务正常</p>

          <div
            className="summary__track"
            role="progressbar"
            aria-label="正常服务数量"
            aria-valuemin={0}
            aria-valuemax={SERVICES.length}
            aria-valuenow={okCount}
          >
            <span
              className="summary__bar"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="summary__legend">
            <span>
              <i className="legend-dot legend-dot--success" aria-hidden="true" />
              正常 {okCount}
            </span>
            <span>
              <i className="legend-dot legend-dot--danger" aria-hidden="true" />
              需关注 {attentionCount}
            </span>
          </div>

          <p className="summary__message">{summaryMessage}</p>
          <p className="summary__time">
            {lastCheckedAt
              ? `最近检测 ${formatTime(lastCheckedAt)}`
              : '正在执行首次检测…'}
          </p>
        </aside>
      </section>

      <section className="checks" aria-labelledby="checks-title">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">DEPENDENCIES</p>
            <h2 id="checks-title">依赖服务</h2>
          </div>
          <p className="section-heading__hint">
            三个接口并行检测，也可以单独重试
          </p>
        </div>

        <div className="status-grid">
          {SERVICES.map((service) => (
            <StatusCard
              key={service.id}
              service={service}
              check={checks[service.id]}
              onRefresh={refresh}
            />
          ))}
        </div>
      </section>
    </main>
  )
}
