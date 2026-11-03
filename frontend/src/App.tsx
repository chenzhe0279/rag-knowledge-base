import { lazy, Suspense, useEffect, useState } from 'react'
import {
  BrandIcon,
  ChatIcon,
  DashboardIcon,
  EvaluationIcon,
  FileTextIcon,
  ServerIcon,
} from './components/Icons'
import { AccountMenu } from './components/AccountMenu'
import { Spinner } from './components/Spinner'
import { DashboardPage } from './dashboard/DashboardPage'
import { getMe } from './api/auth'
import {
  AUTH_EXPIRED_EVENT,
  clearAuthToken,
  getAuthToken,
} from './lib/authSession'
import type { LoginResponse, MeResponse } from './types/auth'
import './App.css'
import './theme.css'

const ChatPage = lazy(() =>
  import('./pages/ChatPage').then((module) => ({ default: module.ChatPage })),
)
const DocumentDetailPage = lazy(() =>
  import('./pages/DocumentDetailPage').then((module) => ({
    default: module.DocumentDetailPage,
  })),
)
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((module) => ({
    default: module.DocumentsPage,
  })),
)
const EvaluationPage = lazy(() =>
  import('./pages/EvaluationPage').then((module) => ({
    default: module.EvaluationPage,
  })),
)
const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((module) => ({
    default: module.AdminPage,
  })),
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({
    default: module.LoginPage,
  })),
)
const SystemStatusPage = lazy(() =>
  import('./pages/SystemStatusPage').then((module) => ({
    default: module.SystemStatusPage,
  })),
)

type AppView =
  | 'dashboard'
  | 'documents'
  | 'chat'
  | 'evaluations'
  | 'admin'
  | 'status'

function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '登录状态校验失败'
}

function App() {
  const [view, setView] = useState<AppView>('dashboard')
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  )
  const [session, setSession] = useState<MeResponse | null>(null)
  const [authChecking, setAuthChecking] = useState(() =>
    Boolean(getAuthToken()),
  )
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (!getAuthToken()) {
      return
    }

    let active = true

    getMe()
      .then((me) => {
        if (active) {
          setSession(me)
          setAuthError(null)
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }
        clearAuthToken()
        setSession(null)
        setAuthError(authErrorMessage(error))
      })
      .finally(() => {
        if (active) {
          setAuthChecking(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      setSession(null)
      setAuthError(detail?.message ?? '登录已过期，请重新登录')
      setView('dashboard')
      setSelectedDocumentId(null)
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedDocumentId])

  const handleLoggedIn = (loginSession: LoginResponse) => {
    setSession({
      user: loginSession.user,
      permission_tags: loginSession.permission_tags,
      is_admin: loginSession.is_admin,
    })
    setAuthError(null)
    setView('dashboard')
    setSelectedDocumentId(null)
  }

  const handleLogout = () => {
    clearAuthToken()
    setSession(null)
    setAuthError(null)
    setView('dashboard')
    setSelectedDocumentId(null)
  }

  const showDashboard = () => {
    setView('dashboard')
    setSelectedDocumentId(null)
  }

  const showDocuments = () => {
    setView('documents')
    setSelectedDocumentId(null)
  }

  const showChat = () => {
    setView('chat')
    setSelectedDocumentId(null)
  }

  const showEvaluations = () => {
    if (!session?.is_admin) {
      return
    }
    setView('evaluations')
    setSelectedDocumentId(null)
  }

  const showAdmin = () => {
    if (!session?.is_admin) {
      return
    }
    setView('admin')
    setSelectedDocumentId(null)
  }

  const showStatus = () => {
    setView('status')
    setSelectedDocumentId(null)
  }

  const openDocumentFromChat = (documentId: string) => {
    setView('documents')
    setSelectedDocumentId(documentId)
  }

  if (authChecking) {
    return (
      <div className="auth-boot" role="status">
        <span className="auth-boot__mark">
          <BrandIcon />
        </span>
        <Spinner label="正在校验登录状态" />
        <span>正在恢复安全会话…</span>
      </div>
    )
  }

  if (!session) {
    return (
      <Suspense
        fallback={
          <div className="auth-boot">
            <Spinner label="正在加载登录页" />
          </div>
        }
      >
        <LoginPage
          initialError={authError}
          onLoggedIn={handleLoggedIn}
        />
      </Suspense>
    )
  }

  if (view === 'dashboard') {
    return (
      <Suspense
        fallback={
          <div className="app-view-loading" role="status">
            <Spinner label="正在加载看板" />
          </div>
        }
      >
        <DashboardPage
          account={
            <AccountMenu
              session={session}
              onManageUsers={showAdmin}
              onLogout={handleLogout}
            />
          }
          showEvaluations={session.is_admin}
          onNavigate={(destination) => {
            setSelectedDocumentId(null)
            setView(destination)
          }}
        />
      </Suspense>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          type="button"
          className="brand"
          onClick={showDocuments}
          aria-label="返回文档库"
        >
          <span className="brand__mark">
            <BrandIcon />
          </span>
          <span className="brand__copy">
            <strong>RAG Knowledge Base</strong>
            <span>知识库控制台</span>
          </span>
        </button>

        <nav className="main-nav" aria-label="主导航">
          <button
            type="button"
            className="main-nav__item"
            onClick={showDashboard}
          >
            <DashboardIcon className="icon" />
            数据看板
          </button>
          <button
            type="button"
            className={
              view === 'documents'
                ? 'main-nav__item is-active'
                : 'main-nav__item'
            }
            onClick={showDocuments}
          >
            <FileTextIcon className="icon" />
            文档库
          </button>
          <button
            type="button"
            className={
              view === 'chat' ? 'main-nav__item is-active' : 'main-nav__item'
            }
            onClick={showChat}
          >
            <ChatIcon className="icon" />
            知识问答
          </button>
          {session.is_admin ? (
            <button
              type="button"
              className={
                view === 'evaluations'
                  ? 'main-nav__item is-active'
                  : 'main-nav__item'
              }
              onClick={showEvaluations}
            >
              <EvaluationIcon className="icon" />
              评测中心
            </button>
          ) : null}
          <button
            type="button"
            className={
              view === 'status' ? 'main-nav__item is-active' : 'main-nav__item'
            }
            onClick={showStatus}
          >
            <ServerIcon className="icon" />
            系统状态
          </button>
        </nav>

        <span className="environment">
          <span className="environment__dot" aria-hidden="true" />
          本地开发环境
        </span>

        <AccountMenu
          session={session}
          onManageUsers={showAdmin}
          onLogout={handleLogout}
        />
      </header>

      <Suspense
        fallback={
          <div className="app-view-loading" role="status">
            <Spinner label="正在加载视图" />
            <span>正在铺开工作台…</span>
          </div>
        }
      >
        {selectedDocumentId ? (
          <DocumentDetailPage
            documentId={selectedDocumentId}
            isAdmin={session.is_admin}
            onBack={showDocuments}
            onDeleted={showDocuments}
          />
        ) : view === 'chat' ? (
          <ChatPage onOpenDocument={openDocumentFromChat} />
        ) : view === 'evaluations' && session.is_admin ? (
          <EvaluationPage />
        ) : view === 'admin' && session.is_admin ? (
          <AdminPage session={session} />
        ) : view === 'status' ? (
          <SystemStatusPage />
        ) : (
          <DocumentsPage
            isAdmin={session.is_admin}
            onOpenDocument={setSelectedDocumentId}
          />
        )}
      </Suspense>

      <footer className="page-footer">
        <p>RAG Knowledge Base · React + TypeScript + Vite</p>
        <p>
          JWT + RBAC · 权限在每次请求时由后端实时校验
        </p>
      </footer>
    </div>
  )
}

export default App
