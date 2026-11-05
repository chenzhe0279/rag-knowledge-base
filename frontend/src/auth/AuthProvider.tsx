import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchMe } from '../api/auth'
import { isAbortError } from '../api/http'
import type { AuthSession, LoginResponse, MeResponse } from '../types/api'
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext'
import {
  AUTH_EXPIRED_EVENT,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
  type AuthExpiredDetail,
} from './authSession'

function toSession(response: MeResponse | LoginResponse): AuthSession {
  return {
    user: response.user,
    permissionTags: response.permission_tags ?? [],
    isAdmin: response.is_admin,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    getAuthToken() ? 'checking' : 'anonymous',
  )
  const [session, setSession] = useState<AuthSession | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 启动时用 /auth/me 恢复会话
  useEffect(() => {
    if (!getAuthToken()) return
    const controller = new AbortController()
    fetchMe(controller.signal)
      .then((me) => {
        setSession(toSession(me))
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        clearAuthToken()
        setSession(null)
        setStatus('anonymous')
        setNotice(error instanceof Error ? error.message : '登录状态已失效，请重新登录')
      })
    return () => controller.abort()
  }, [])

  // 任意请求 401 → 回登录页
  useEffect(() => {
    function handleExpired(event: Event) {
      const detail = (event as CustomEvent<AuthExpiredDetail>).detail
      setSession(null)
      setStatus('anonymous')
      setNotice(detail?.message || '登录已失效，请重新登录')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
  }, [])

  const signIn = useCallback((response: LoginResponse) => {
    setAuthToken(response.access_token)
    setSession(toSession(response))
    setNotice(null)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(() => {
    clearAuthToken()
    setSession(null)
    setNotice(null)
    setStatus('anonymous')
  }, [])

  const refresh = useCallback(async () => {
    const me = await fetchMe()
    setSession(toSession(me))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, notice, signIn, signOut, refresh }),
    [status, session, notice, signIn, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
