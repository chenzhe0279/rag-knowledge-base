/** 后端健康检查接口返回的状态值。 */
export const HEALTH_STATUSES = ['ok', 'error', 'not_configured'] as const

export type HealthStatus = (typeof HEALTH_STATUSES)[number]

/** `GET /api/health*` 的统一响应结构。 */
export interface HealthResponse {
  status: HealthStatus
  detail?: string | null
}

export type ServiceId = 'api' | 'db' | 'cos'

export type ServiceIconName = 'server' | 'database' | 'cloud'

/** 首页一张状态卡片对应的后端检查项。 */
export interface ServiceDefinition {
  id: ServiceId
  name: string
  category: string
  description: string
  endpoint: string
  icon: ServiceIconName
}

export type HealthCheckPhase = 'loading' | 'success' | 'failure'

/** 单个服务在前端的一次检测结果。 */
export interface HealthCheck {
  phase: HealthCheckPhase
  response: HealthResponse | null
  error: string | null
  latencyMs: number | null
  checkedAt: Date | null
  refreshing: boolean
}

export type HealthCheckMap = Record<ServiceId, HealthCheck>
