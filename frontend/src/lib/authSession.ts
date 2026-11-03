const TOKEN_KEY = 'rag-kb-access-token'
export const AUTH_EXPIRED_EVENT = 'rag-kb-auth-expired'

let memoryToken: string | null = null

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getAuthToken(): string | null {
  if (memoryToken === null) {
    memoryToken = readStoredToken()
  }
  return memoryToken
}

export function setAuthToken(token: string): void {
  memoryToken = token
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // localStorage 不可用时仅保留内存态，本次会话仍可继续。
  }
}

export function clearAuthToken(): void {
  memoryToken = null
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

/** 401 统一出口：清 token，并通知 App 切回登录页。 */
export function notifyAuthExpired(message = '登录已过期，请重新登录'): void {
  clearAuthToken()
  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { message } }),
  )
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = getAuthToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(input, { ...init, headers })
  if (response.status === 401) {
    notifyAuthExpired()
  }
  return response
}
