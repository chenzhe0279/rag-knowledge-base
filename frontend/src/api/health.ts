import type { HealthStatus } from '../types/api'
import { request } from './http'

export type HealthTarget = 'api' | 'db' | 'cos'

const HEALTH_PATHS: Record<HealthTarget, string> = {
  api: '/health',
  db: '/health/db',
  cos: '/health/cos',
}

export function fetchHealth(target: HealthTarget, signal?: AbortSignal) {
  return request<HealthStatus>(HEALTH_PATHS[target], { signal, auth: false })
}
