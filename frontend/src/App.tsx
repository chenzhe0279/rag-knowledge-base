import { lazy, Suspense, useEffect, useState } from 'react'
import {
  BrandIcon,
  ChatIcon,
  DashboardIcon,
  FileTextIcon,
  ServerIcon,
} from './components/Icons'
import { Spinner } from './components/Spinner'
import { DashboardPage } from './dashboard/DashboardPage'
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
const SystemStatusPage = lazy(() =>
  import('./pages/SystemStatusPage').then((module) => ({
    default: module.SystemStatusPage,
  })),
)

type AppView = 'dashboard' | 'documents' | 'chat' | 'status'

function App() {
  const [view, setView] = useState<AppView>('dashboard')
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedDocumentId])

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

  const showStatus = () => {
    setView('status')
    setSelectedDocumentId(null)
  }

  const openDocumentFromChat = (documentId: string) => {
    setView('documents')
    setSelectedDocumentId(documentId)
  }

  if (view === 'dashboard') {
    return (
      <DashboardPage
        onNavigate={(destination) => {
          setSelectedDocumentId(null)
          setView(destination)
        }}
      />
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
            onBack={showDocuments}
            onDeleted={showDocuments}
          />
        ) : view === 'chat' ? (
          <ChatPage onOpenDocument={openDocumentFromChat} />
        ) : view === 'status' ? (
          <SystemStatusPage />
        ) : (
          <DocumentsPage onOpenDocument={setSelectedDocumentId} />
        )}
      </Suspense>

      <footer className="page-footer">
        <p>RAG Knowledge Base · React + TypeScript + Vite</p>
        <p>
          SSE 流式问答 · 类型由 <code>npm run gen:api</code> 从后端 OpenAPI 同步
        </p>
      </footer>
    </div>
  )
}

export default App

