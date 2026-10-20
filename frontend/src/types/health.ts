import type { components } from './schema'

/** 健康检查接口响应，直接复用 OpenAPI 生成的类型。 */
export type HealthResponse = components['schemas']['HealthStatus']

export type HealthStatus = HealthResponse['status']

/** 运行时校验用的状态值列表，类型上确保与 OpenAPI 定义保持一致。 */
export const HEALTH_STATUSES = [
  'ok',
  'error',
  'not_configured',
] as const satisfies readonly HealthStatus[]

export type ServiceId = 'api' | 'db' | 'cos'

export type ServiceIconName = 'server' | 'database' | 'cloud'

/** 状态卡片对应的后端检查项。 */
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
