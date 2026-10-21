import { useEffect, useState } from 'react'
import {
  BrandIcon,
  ChatIcon,
  FileTextIcon,
  ServerIcon,
} from './components/Icons'
import { ChatPage } from './pages/ChatPage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { SystemStatusPage } from './pages/SystemStatusPage'
import './App.css'
import './theme.css'

type AppView = 'documents' | 'chat' | 'status'

function App() {
  const [view, setView] = useState<AppView>('documents')
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedDocumentId])

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

