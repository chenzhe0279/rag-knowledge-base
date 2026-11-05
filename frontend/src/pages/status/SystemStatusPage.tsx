import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchHealth, type HealthTarget } from '../../api/health'
import { errorMessage, isAbortError } from '../../api/http'
import { CloudIcon, DatabaseIcon, RefreshIcon, ServerIcon } from '../../components/Icons'
import { StatusBadge } from '../../components/StatusBadge'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatLatency, formatTime } from '../../lib/format'
import type { Tone } from '../../lib/documents'
import type { HealthStatus } from '../../types/api'
import './SystemStatusPage.css'

type CheckState =
  | { phase: 'checking' }
  | {
      phase: 'done'
      result: HealthStatus | null
      error: string | null
      latency: number
      checkedAt: Date
    }

interface ServiceMeta {
  target: HealthTarget
  name: string
  endpoint: string
  desc: string
  icon: ReactNode
}

const SERVICES: ServiceMeta[] = [
  {
    target: 'api',
    name: 'API 服务',
    endpoint: 'GET /api/health',
    desc: 'FastAPI 应用进程是否正常响应',
    icon: <ServerIcon size={22} />,
  },
  {
    target: 'db',
    name: 'PostgreSQL',
    endpoint: 'GET /api/health/db',
    desc: '执行 SELECT 1 验证数据库连接',
    icon: <DatabaseIcon size={22} />,
  },
  {
    target: 'cos',
    name: '腾讯云 COS',
    endpoint: 'GET /api/health/cos',
    desc: '对象存储桶连通性（原文与缩略图）',
    icon: <CloudIcon size={22} />,
  },
]

function describe(state: CheckState): { tone: Tone; label: string; live: boolean } {
  if (state.phase === 'checking') return { tone: 'pending', label: '检测中', live: true }
  if (state.error) return { tone: 'danger', label: '无法连接', live: false }
  switch (state.result?.status) {
    case 'ok':
      return { tone: 'success', label: '正常', live: false }
    case 'not_configured':
      return { tone: 'warning', label: '未配置', live: false }
    default:
      return { tone: 'danger', label: '异常', live: false }
  }
}

function useHealthCheck(target: HealthTarget) {
  const [state, setState] = useState<CheckState>({ phase: 'checking' })
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ phase: 'checking' })
    const started = performance.now()
    try {
      const result = await fetchHealth(target, controller.signal)
      setState({
        phase: 'done',
        result,
        error: null,
        latency: performance.now() - started,
        checkedAt: new Date(),
      })
    } catch (error) {
      if (isAbortError(error)) return
      setState({
        phase: 'done',
        result: null,
        error: errorMessage(error, '检测失败'),
        latency: performance.now() - started,
        checkedAt: new Date(),
      })
    }
  }, [target])

  useEffect(() => {
    // 首次进入页面自动检测一次
    const timer = window.setTimeout(() => void run(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [run])

  return { state, run }
}

function ServiceCard({
  service,
  check,
}: {
  service: ServiceMeta
  check: ReturnType<typeof useHealthCheck>
}) {
  const { state, run } = check
  const status = describe(state)
  const detail =
    state.phase === 'checking'
      ? '正在请求…'
      : (state.error ?? state.result?.detail ?? '服务响应正常')

  return (
    <article className="status-card soft-card" data-tone={status.tone}>
      <header className="status-card__head">
        <span className="status-card__icon" aria-hidden="true">
          {service.icon}
        </span>
        <div className="status-card__title">
          <h2>{service.name}</h2>
          <span className="mono faint">{service.endpoint}</span>
        </div>
        <StatusBadge tone={status.tone} label={status.label} live={status.live} />
      </header>

      <p className="status-card__desc muted">{service.desc}</p>

      <dl className="facts status-card__facts">
        <div>
          <dt>响应耗时</dt>
          <dd className="num">{state.phase === 'done' ? formatLatency(state.latency) : '—'}</dd>
        </div>
        <div>
          <dt>检测时间</dt>
          <dd className="num">{state.phase === 'done' ? formatTime(state.checkedAt) : '—'}</dd>
        </div>
      </dl>

      <p className="status-card__detail" aria-live="polite">
        {detail}
      </p>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => void run()}
        disabled={state.phase === 'checking'}
      >
        <RefreshIcon size={14} />
        重新检测
      </button>
    </article>
  )
}

export function SystemStatusPage() {
  useDocumentTitle('系统状态')
  const api = useHealthCheck('api')
  const db = useHealthCheck('db')
  const cos = useHealthCheck('cos')
  const checks = { api, db, cos }
  const states = [api.state, db.state, cos.state]
  const anyChecking = states.some((state) => state.phase === 'checking')
  const okCount = states.filter(
    (state) => state.phase === 'done' && !state.error && state.result?.status === 'ok',
  ).length

  function refreshAll() {
    void api.run()
    void db.run()
    void cos.run()
  }

  return (
    <main className="page">
      <section className="page-hero">
        <div className="page-hero__copy">
          <span className="eyebrow">System Status</span>
          <h1 className="hero-title">
            系统状态
            <span>运行健康</span>
          </h1>
          <p className="hero-lead">
            直接调用后端健康检查接口，独立检测 API、数据库与对象存储，任何一项失败都不会影响其他项。
          </p>
        </div>
        <div className="page-hero__aside">
          <div className="dark-block status-summary">
            <span className="eyebrow">Healthy services</span>
            <strong className="status-summary__value num">
              {anyChecking ? '—' : okCount}
              <small>/ {SERVICES.length}</small>
            </strong>
            <button
              type="button"
              className="btn btn--primary"
              onClick={refreshAll}
              disabled={anyChecking}
            >
              <RefreshIcon size={16} className={anyChecking ? 'spin' : undefined} />
              {anyChecking ? '检测中…' : '全部刷新'}
            </button>
          </div>
        </div>
      </section>

      <section className="status-grid" aria-label="服务检测结果">
        {SERVICES.map((service) => (
          <ServiceCard key={service.target} service={service} check={checks[service.target]} />
        ))}
      </section>
    </main>
  )
}
