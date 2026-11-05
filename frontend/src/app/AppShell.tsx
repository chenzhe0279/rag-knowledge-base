import type { ReactNode } from 'react'
import { useSession } from '../auth/useAuth'
import { AccountMenu } from '../components/AccountMenu'
import { Brand } from '../components/Brand'
import {
  ChatIcon,
  DashboardIcon,
  FileIcon,
  FlaskIcon,
  ServerIcon,
} from '../components/Icons'
import { API_DOCS_URL } from '../config'
import { Link } from './Link'
import { paths, type RouteName } from './router'
import './AppShell.css'

interface NavItem {
  key: string
  label: string
  to: string
  icon: ReactNode
  match: RouteName[]
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: '数据看板',
    to: paths.dashboard(),
    icon: <DashboardIcon size={16} />,
    match: ['dashboard'],
  },
  {
    key: 'documents',
    label: '文档库',
    to: paths.documents(),
    icon: <FileIcon size={16} />,
    match: ['documents', 'document'],
  },
  {
    key: 'chat',
    label: '知识问答',
    to: paths.chat(),
    icon: <ChatIcon size={16} />,
    match: ['chat'],
  },
  {
    key: 'evaluations',
    label: '评测中心',
    to: paths.evaluations(),
    icon: <FlaskIcon size={16} />,
    match: ['evaluations'],
    adminOnly: true,
  },
  {
    key: 'status',
    label: '系统状态',
    to: paths.status(),
    icon: <ServerIcon size={16} />,
    match: ['status'],
  },
]

export function AppShell({ active, children }: { active: RouteName; children: ReactNode }) {
  const { isAdmin } = useSession()
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to={paths.dashboard()} className="topbar__brand" aria-label="返回数据看板">
            <Brand />
          </Link>
          <nav className="topbar__nav" aria-label="主导航">
            {items.map((item) => {
              const current = item.match.includes(active)
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  className="topbar__link"
                  aria-current={current ? 'page' : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
          <div className="topbar__end">
            <span className="topbar__env">
              <span className="dot" aria-hidden="true" />
              {import.meta.env.DEV ? '本地开发环境' : '生产环境'}
            </span>
            <AccountMenu />
          </div>
        </div>
      </header>
      <div id="main-content" className="app-shell__main" tabIndex={-1}>
        {children}
      </div>
      <footer className="app-footer">
        <span>RAG Knowledge Base · FastAPI · pgvector · Celery · React 19</span>
        <a href={API_DOCS_URL} target="_blank" rel="noreferrer noopener">
          API 文档
        </a>
      </footer>
    </div>
  )
}
