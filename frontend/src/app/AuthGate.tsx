import { lazy, Suspense } from 'react'
import { useAuth } from '../auth/useAuth'
import { Brand } from '../components/Brand'
import { AppRoutes } from './AppRoutes'
import './AuthGate.css'

const LoginPage = lazy(() =>
  import('../pages/login/LoginPage').then((module) => ({ default: module.LoginPage })),
)

function BootScreen() {
  return (
    <div className="boot-screen" role="status">
      <Brand compact />
      <span className="spinner" aria-hidden="true" />
      <span className="boot-screen__text">正在恢复登录状态…</span>
    </div>
  )
}

/** 认证闸门：恢复会话 → 登录页 / 应用路由。 */
export function AuthGate() {
  const { status } = useAuth()
  if (status === 'checking') return <BootScreen />
  if (status === 'anonymous') {
    return (
      <Suspense fallback={<BootScreen />}>
        <LoginPage />
      </Suspense>
    )
  }
  return <AppRoutes />
}
