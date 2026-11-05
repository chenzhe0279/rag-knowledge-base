import { createContext } from 'react'
import type { AuthSession, LoginResponse } from '../types/api'

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  session: AuthSession | null
  /** 401 / 会话失效时给登录页展示的原因。 */
  notice: string | null
  signIn: (response: LoginResponse) => void
  signOut: () => void
  /** 重新调用 /auth/me（例如管理员改了自己的昵称）。 */
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
