import { useEffect, useState } from 'react'
import { BrandIcon, FileTextIcon, ServerIcon } from './components/Icons'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { SystemStatusPage } from './pages/SystemStatusPage'
import './App.css'

type AppView = 'documents' | 'status'

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

  const showStatus = () => {
    setView('status')
    setSelectedDocumentId(null)
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

      {view === 'status' ? (
        <SystemStatusPage />
      ) : selectedDocumentId ? (
        <DocumentDetailPage
          documentId={selectedDocumentId}
          onBack={showDocuments}
          onDeleted={showDocuments}
        />
      ) : (
        <DocumentsPage onOpenDocument={setSelectedDocumentId} />
      )}

      <footer className="page-footer">
        <p>
          RAG Knowledge Base · React + TypeScript + Vite
        </p>
        <p>
          类型由 <code>npm run gen:api</code> 从后端 OpenAPI 同步，开发环境经
          Vite 代理访问 <code>http://127.0.0.1:8000</code>
        </p>
      </footer>
    </div>
  )
}

export default App
