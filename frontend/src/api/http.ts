import { API_BASE_URL } from '../config'
import { authHeaders, notifyAuthExpired } from '../auth/authSession'

/** 统一的前端错误类型：携带 HTTP 状态码与后端业务 code。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export const RATE_LIMIT_MESSAGE = '请求过于频繁，请稍后再试'
export const NETWORK_ERROR_MESSAGE = '无法连接到后端服务，请检查网络或确认后端已启动'

const STATUS_FALLBACK: Record<number, string> = {
  400: '请求参数有误',
  401: '登录已失效，请重新登录',
  403: '仅管理员可访问',
  404: '资源不存在或无权访问',
  409: '数据冲突，请刷新后重试',
  413: '文件过大',
  422: '参数校验失败',
  429: RATE_LIMIT_MESSAGE,
  500: '服务内部错误',
  502: '后端网关异常',
  503: '服务暂不可用',
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}/api${path}`
}

/** 解析 `{code,message}` / `{detail: string}` / `{detail: [{msg}]}` 三种错误体。 */
export function parseErrorBody(body: unknown): { message: string | null; code: string | null } {
  if (!body || typeof body !== 'object') return { message: null, code: null }
  const record = body as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : null
  if (typeof record.message === 'string' && record.message) {
    return { message: record.message, code }
  }
  const detail = record.detail
  if (typeof detail === 'string' && detail) return { message: detail, code }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        item && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string'
          ? (item as { msg: string }).msg
          : null,
      )
      .filter((msg): msg is string => Boolean(msg))
    if (messages.length) return { message: messages.join('；'), code }
  }
  return { message: null, code }
}

export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const parsed = parseErrorBody(body)
  // 429 统一中文提示，但保留后端给出的次数信息
  const message =
    parsed.message ?? STATUS_FALLBACK[response.status] ?? `请求失败（HTTP ${response.status}）`
  return new ApiError(message, response.status, parsed.code)
}

export function errorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Query
  json?: unknown
  form?: FormData
  signal?: AbortSignal
  /** 公开接口（登录/健康检查）不附加 token，也不触发 401 登出。 */
  auth?: boolean
}

function buildUrl(path: string, query?: Query): string {
  const url = apiUrl(path)
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `${url}?${search}` : url
}

export async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', query, json, form, signal, auth = true } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (auth) Object.assign(headers, authHeaders())
  let body: BodyInit | undefined
  if (form) {
    body = form
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), { method, headers, body, signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0, 'network_error')
  }

  if (!response.ok) {
    const error = await toApiError(response)
    if (response.status === 401 && auth) notifyAuthExpired(error.message)
    throw error
  }
  return response
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(path, options)
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}
