import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './AuthContext'
import type { AuthSession } from '../types/api'

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return context
}

/** 受保护页面内使用：AuthGate 已保证 session 存在。 */
export function useSession(): AuthSession {
  const { session } = useAuth()
  if (!session) throw new Error('当前没有登录会话')
  return session
}
