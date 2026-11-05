/**
 * JWT 存储与 401 处理。
 *
 * token 存 localStorage，同时缓存在内存里，避免每个请求都读存储；
 * 任意请求返回 401 时清理 token 并派发全局事件，由 AuthProvider 切回登录页。
 */
const TOKEN_KEY = 'rag-kb-access-token'

export const AUTH_EXPIRED_EVENT = 'rag-kb-auth-expired'

export interface AuthExpiredDetail {
  message: string
}

let memoryToken: string | null | undefined

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getAuthToken(): string | null {
  if (memoryToken === undefined) {
    memoryToken = readStorage()
  }
  return memoryToken
}

export function setAuthToken(token: string): void {
  memoryToken = token
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // 隐私模式下写入失败时，仍可用内存 token 完成本次会话
  }
}

export function clearAuthToken(): void {
  memoryToken = null
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 忽略存储不可用
  }
}

export function notifyAuthExpired(message: string): void {
  clearAuthToken()
  window.dispatchEvent(
    new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, { detail: { message } }),
  )
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
