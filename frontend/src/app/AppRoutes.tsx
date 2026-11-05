import { lazy, Suspense, type ReactNode } from 'react'
import { useSession } from '../auth/useAuth'
import { SearchIcon, ShieldIcon } from '../components/Icons'
import { EmptyState, PageLoader } from '../components/States'
import { AppShell } from './AppShell'
import { Link } from './Link'
import { parseRoute, paths, usePathname } from './router'

const DashboardPage = lazy(() =>
  import('../pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const DocumentsPage = lazy(() =>
  import('../pages/documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
)
const DocumentDetailPage = lazy(() =>
  import('../pages/document-detail/DocumentDetailPage').then((m) => ({
    default: m.DocumentDetailPage,
  })),
)
const ChatPage = lazy(() => import('../pages/chat/ChatPage').then((m) => ({ default: m.ChatPage })))
const EvaluationPage = lazy(() =>
  import('../pages/evaluation/EvaluationPage').then((m) => ({ default: m.EvaluationPage })),
)
const AccessPage = lazy(() =>
  import('../pages/access/AccessPage').then((m) => ({ default: m.AccessPage })),
)
const SystemStatusPage = lazy(() =>
  import('../pages/status/SystemStatusPage').then((m) => ({ default: m.SystemStatusPage })),
)

/** 前端路由守卫；真正的权限校验仍由后端 403 兜底。 */
function AdminGuard({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession()
  if (isAdmin) return children
  return (
    <main className="page">
      <section className="glass glass--pad">
        <EmptyState
          icon={<ShieldIcon size={26} />}
          title="仅管理员可访问"
          description="当前账号没有访问该页面的权限，如需开通请联系管理员。"
          action={
            <Link to={paths.dashboard()} className="btn btn--primary">
              返回数据看板
            </Link>
          }
        />
      </section>
    </main>
  )
}

function NotFound() {
  return (
    <main className="page">
      <section className="glass glass--pad">
        <EmptyState
          icon={<SearchIcon size={26} />}
          title="页面不存在"
          description="链接可能已失效，或者页面已被移动。"
          action={
            <Link to={paths.dashboard()} className="btn btn--primary">
              返回数据看板
            </Link>
          }
        />
      </section>
    </main>
  )
}

export function AppRoutes() {
  const route = parseRoute(usePathname())

  // 数据看板是独立的全屏视觉页，不使用普通顶栏壳
  if (route.name === 'dashboard') {
    return (
      <Suspense fallback={<PageLoader label="Loading dashboard" />}>
        <DashboardPage />
      </Suspense>
    )
  }

  let content: ReactNode
  switch (route.name) {
    case 'documents':
      content = <DocumentsPage />
      break
    case 'document':
      content = <DocumentDetailPage key={route.id} documentId={route.id} />
      break
    case 'chat':
      content = <ChatPage conversationId={route.conversationId} />
      break
    case 'evaluations':
      content = (
        <AdminGuard>
          <EvaluationPage />
        </AdminGuard>
      )
      break
    case 'access':
      content = (
        <AdminGuard>
          <AccessPage />
        </AdminGuard>
      )
      break
    case 'status':
      content = <SystemStatusPage />
      break
    default:
      content = <NotFound />
  }

  return (
    <AppShell active={route.name}>
      <Suspense fallback={<PageLoader />}>{content}</Suspense>
    </AppShell>
  )
}
