import { API_BASE_URL } from '../config'
import { HEALTH_STATUSES } from '../types/health'
import type { HealthResponse } from '../types/health'

const DEFAULT_TIMEOUT_MS = 10_000

export class HealthRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HealthRequestError'
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  const status = record.status

  return (
    typeof status === 'string' &&
    (HEALTH_STATUSES as readonly string[]).includes(status) &&
    (record.detail === undefined ||
      record.detail === null ||
      typeof record.detail === 'string')
  )
}

export interface HealthRequestResult {
  data: HealthResponse
  latencyMs: number
}

/**
 * 请求单个健康检查接口。
 *
 * 统一把超时、网络错误、非 2xx 响应和非法响应体转换成可读的中文错误，
 * 交给卡片直接展示，避免把浏览器原始报错暴露给用户。
 */
export async function fetchHealth(
  endpoint: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HealthRequestResult> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    const latencyMs = Math.round(performance.now() - startedAt)

    if (!response.ok) {
      throw new HealthRequestError(`接口返回 HTTP ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new HealthRequestError('接口返回的内容不是合法 JSON')
    }

    if (!isHealthResponse(payload)) {
      throw new HealthRequestError('接口返回的数据结构不符合预期')
    }

    return { data: payload, latencyMs }
  } catch (error) {
    if (error instanceof HealthRequestError) {
      throw error
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new HealthRequestError(`请求超时（超过 ${timeoutMs / 1000} 秒）`)
    }

    throw new HealthRequestError('无法连接后端服务，请确认服务已启动')
  } finally {
    window.clearTimeout(timeoutId)
  }
}
