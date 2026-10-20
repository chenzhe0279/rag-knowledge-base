import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertIcon,
  ArrowLeftIcon,
  CloseIcon,
  DownloadIcon,
  EyeIcon,
  LayersIcon,
  PencilIcon,
  RefreshIcon,
  TrashIcon,
} from '../components/Icons'
import { DocumentPreview } from '../components/DocumentPreview'
import { FileTypeTile } from '../components/FileTypeTile'
import { Modal } from '../components/Modal'
import { RenameDocumentDialog } from '../components/RenameDocumentDialog'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/StatusBadge'
import {
  deleteDocument,
  getDocumentChunk,
  getDocumentFileUrl,
  listDocumentChunks,
  retryDocument,
} from '../api/documents'
import { useDocumentDetail } from '../hooks/useDocumentDetail'
import {
  DOCUMENT_STATUS_META,
  getDocumentKind,
  getDocumentKindLabel,
  isProcessingStatus,
} from '../lib/documents'
import { formatBytes, formatDateTime } from '../lib/format'
import type {
  DocumentChunkDetail,
  DocumentChunkListResponse,
  DocumentRead,
  DocumentStatus,
} from '../types/documents'
import './DocumentDetailPage.css'

interface DocumentDetailPageProps {
  documentId: string
  onBack: () => void
  onDeleted: () => void
}

type DetailTab = 'preview' | 'chunks'

export function DocumentDetailPage({
  documentId,
  onBack,
  onDeleted,
}: DocumentDetailPageProps) {
  const { document, loading, error, refresh } = useDocumentDetail(documentId)
  const [activeTab, setActiveTab] = useState<DetailTab>('preview')
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  const handleRetry = async () => {
    if (!document) {
      return
    }

    setRetrying(true)
    setActionError(null)

    try {
      await retryDocument(document.id)
      refresh()
    } catch (retryError) {
      setActionError(
        retryError instanceof Error ? retryError.message : '重新处理失败',
      )
    } finally {
      setRetrying(false)
    }
  }

  if (loading && !document) {
    return <DetailSkeleton onBack={onBack} />
  }

  if (!document) {
    return (
      <main className="detail-page">
        <div className="detail-topbar">
          <button type="button" className="back-link" onClick={onBack}>
            <ArrowLeftIcon className="icon" />
            返回文档库
          </button>
        </div>
        <div className="detail-state" role="alert">
          <span className="detail-state__icon">
            <AlertIcon />
          </span>
          <h1>无法加载这份文档</h1>
          <p>{error ?? '文档不存在或已经被删除。'}</p>
          <div className="detail-state__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={refresh}
            >
              重试
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={onBack}
            >
              返回文档库
            </button>
          </div>
        </div>
      </main>
    )
  }

  const meta = DOCUMENT_STATUS_META[document.status]
  const kind = getDocumentKind(document)
  const downloadUrl = getDocumentFileUrl(document.id, { download: true })

  return (
    <main className="detail-page">
      <div className="detail-topbar">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeftIcon className="icon" />
          返回文档库
        </button>
        <div className="detail-actions">
          <a className="button button--ghost button--sm" href={downloadUrl}>
            <DownloadIcon className="icon" />
            下载
          </a>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setRenameOpen(true)}
          >
            <PencilIcon className="icon" />
            重命名
          </button>
          {document.status === 'failed' ? (
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={handleRetry}
              disabled={retrying}
            >
              <RefreshIcon
                className={retrying ? 'icon icon--spinning' : 'icon'}
              />
              重新处理
            </button>
          ) : null}
          <button
            type="button"
            className="button button--danger-ghost button--sm"
            onClick={() => setDeleteOpen(true)}
            disabled={document.status === 'parsing' || document.status === 'indexing'}
            title={
              document.status === 'parsing' || document.status === 'indexing'
                ? '文档处理中，暂时不能删除'
                : undefined
            }
          >
            <TrashIcon className="icon" />
            删除
          </button>
        </div>
      </div>

      <section className="detail-header" aria-labelledby="document-title">
        <div className="detail-header__title">
          <FileTypeTile document={document} large />
          <div className="detail-header__copy">
            <div className="detail-title-row">
              <h1 id="document-title">{document.name}</h1>
              <StatusBadge tone={meta.tone} pulse={meta.processing}>
                {meta.label}
              </StatusBadge>
            </div>
            <p className="detail-subtitle">
              {getDocumentKindLabel(kind)} · {formatBytes(document.size)} · 上传于{' '}
              {formatDateTime(document.created_at)}
            </p>
          </div>
        </div>

        <dl className="detail-facts">
          <div>
            <dt>文档 ID</dt>
            <dd>
              <code title={document.id}>{document.id.slice(0, 8)}…</code>
            </dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{formatDateTime(document.updated_at)}</dd>
          </div>
          <div>
            <dt>文件哈希</dt>
            <dd>
              <code title={document.file_hash}>
                {document.file_hash.slice(0, 12)}…
              </code>
            </dd>
          </div>
        </dl>
      </section>

      {actionError ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          <AlertIcon className="icon" />
          <div className="inline-alert__copy">
            <strong>操作失败</strong>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          <AlertIcon className="icon" />
          <div className="inline-alert__copy">
            <strong>状态刷新失败</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={refresh}
          >
            重试
          </button>
        </div>
      ) : null}

      {isProcessingStatus(document.status) ? (
        <ProcessingBanner status={document.status} />
      ) : null}

      {document.status === 'failed' ? (
        <div className="inline-alert inline-alert--danger detail-error" role="alert">
          <AlertIcon className="icon" />
          <div className="inline-alert__copy">
            <strong>文档处理失败</strong>
            <p>{document.error_message ?? '后端没有返回具体错误信息。'}</p>
          </div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={handleRetry}
            disabled={retrying}
          >
            <RefreshIcon
              className={retrying ? 'icon icon--spinning' : 'icon'}
            />
            重新处理
          </button>
        </div>
      ) : null}

      <div className="detail-tabs" role="tablist" aria-label="文档详情视图">
        <button
          type="button"
          role="tab"
          id="tab-preview"
          className={activeTab === 'preview' ? 'detail-tab is-active' : 'detail-tab'}
          aria-selected={activeTab === 'preview'}
          aria-controls="panel-preview"
          onClick={() => setActiveTab('preview')}
        >
          <EyeIcon className="icon" />
          预览
        </button>
        <button
          type="button"
          role="tab"
          id="tab-chunks"
          className={activeTab === 'chunks' ? 'detail-tab is-active' : 'detail-tab'}
          aria-selected={activeTab === 'chunks'}
          aria-controls="panel-chunks"
          onClick={() => setActiveTab('chunks')}
        >
          <LayersIcon className="icon" />
          文本块
        </button>
      </div>

      {activeTab === 'preview' ? (
        <section
          id="panel-preview"
          role="tabpanel"
          aria-labelledby="tab-preview"
          className="detail-panel"
        >
          <DocumentPreview document={document} />
        </section>
      ) : (
        <section
          id="panel-chunks"
          role="tabpanel"
          aria-labelledby="tab-chunks"
          className="detail-panel"
        >
          <DocumentChunksPanel document={document} />
        </section>
      )}

      {deleteOpen ? (
        <DeleteDocumentDialog
          document={document}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onDeleted}
        />
      ) : null}

      {renameOpen ? (
        <RenameDocumentDialog
          document={document}
          onClose={() => setRenameOpen(false)}
          onRenamed={() => {
            setRenameOpen(false)
            refresh()
          }}
        />
      ) : null}
    </main>
  )
}

function ProcessingBanner({ status }: { status: DocumentStatus }) {
  const meta = DOCUMENT_STATUS_META[status]
  const steps = ['上传', '解析', '切分与向量化', '就绪']
  const activeStep =
    status === 'uploading' ? 0 : status === 'parsing' ? 1 : status === 'indexing' ? 2 : 3

  return (
    <div className="processing-banner" role="status">
      <div className="processing-banner__head">
        <Spinner small label={meta.label} />
        <div>
          <strong>{meta.label}</strong>
          <p>{meta.hint}，页面会自动刷新进度。</p>
        </div>
      </div>
      <ol className="processing-steps" aria-label="文档处理阶段">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index <= activeStep ? 'is-active' : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <main className="detail-page" aria-label="文档详情加载中">
      <div className="detail-topbar">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeftIcon className="icon" />
          返回文档库
        </button>
      </div>
      <div className="detail-header">
        <div className="detail-header__title">
          <span className="skeleton-block skeleton-block--tile skeleton-block--tile-lg" />
          <div className="detail-header__copy">
            <span className="skeleton-block skeleton-block--title" />
            <span className="skeleton-block skeleton-block--meta" />
          </div>
        </div>
      </div>
      <div className="detail-skeleton">
        <span className="skeleton-block skeleton-block--toolbar" />
        <span className="skeleton-block skeleton-block--panel" />
      </div>
    </main>
  )
}

/* ---------- 文本块 ---------- */

const CHUNK_PAGE_SIZE = 8

function DocumentChunksPanel({ document }: { document: DocumentRead }) {
  if (document.status !== 'ready') {
    return (
      <div className="chunks-placeholder">
        <span className="chunks-placeholder__icon">
          <LayersIcon />
        </span>
        <h2>文本块暂不可用</h2>
        <p>
          {document.status === 'failed'
            ? '文档处理失败，重新处理后才能生成文本块。'
            : '文档仍在处理中，解析、切分与向量化完成后会自动出现。'}
        </p>
      </div>
    )
  }

  return <ChunksContent key={document.id} document={document} />
}

function ChunksContent({ document }: { document: DocumentRead }) {
  const [data, setData] = useState<DocumentChunkListResponse | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)

    try {
      const response = await listDocumentChunks(
        document.id,
        page,
        CHUNK_PAGE_SIZE,
      )
      if (requestId.current === id) {
        setData(response)
      }
    } catch (loadError) {
      if (requestId.current === id) {
        setError(
          loadError instanceof Error ? loadError.message : '加载文本块失败',
        )
      }
    } finally {
      if (requestId.current === id) {
        setLoading(false)
      }
    }
  }, [document.id, page])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load()

    return () => {
      requestId.current += 1
    }
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / CHUNK_PAGE_SIZE)) : 1

  return (
    <div className="chunks-panel">
      <div className="chunks-heading">
        <div>
          <h2>文本块</h2>
          <p>
            {data
              ? `共 ${data.total} 个文本块 · 第 ${page} / ${totalPages} 页`
              : '正在读取切分结果…'}
          </p>
        </div>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => {
            void load()
          }}
          disabled={loading}
        >
          <RefreshIcon className={loading ? 'icon icon--spinning' : 'icon'} />
          刷新
        </button>
      </div>

      {data?.stats ? (
        <div className="chunk-stats">
          <div>
            <span>文本块总数</span>
            <strong>{data.stats.total}</strong>
          </div>
          <div>
            <span>平均长度</span>
            <strong>{data.stats.avg_length}</strong>
            <small>字符</small>
          </div>
          <div>
            <span>最短</span>
            <strong>{data.stats.min_length}</strong>
            <small>字符</small>
          </div>
          <div>
            <span>最长</span>
            <strong>{data.stats.max_length}</strong>
            <small>字符</small>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          <AlertIcon className="icon" />
          <div className="inline-alert__copy">
            <strong>文本块加载失败</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => {
              void load()
            }}
          >
            重试
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="chunk-grid" aria-label="文本块加载中">
          {Array.from({ length: 4 }, (_, index) => (
            <span className="skeleton-block skeleton-block--chunk" key={index} />
          ))}
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <div className="chunks-placeholder chunks-placeholder--compact">
          <h2>没有文本块</h2>
          <p>这份文档解析后没有切分出任何文本块。</p>
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="chunk-grid">
          {data.items.map((chunk) => (
            <button
              key={chunk.id}
              type="button"
              className="chunk-card"
              onClick={() => setSelectedChunkId(chunk.id)}
            >
              <span className="chunk-card__top">
                <strong>#{chunk.chunk_index + 1}</strong>
                <span>
                  {chunk.page_no ? `第 ${chunk.page_no} 页` : '无页码'}
                  {chunk.section_path ? ` · ${chunk.section_path}` : ''}
                </span>
                <span className="chunk-card__chars">{chunk.char_count} 字符</span>
              </span>
              <span className="chunk-card__excerpt">{chunk.content_excerpt}</span>
              <span className="chunk-card__footer">
                <code>{chunk.chunk_hash.slice(0, 10)}…</code>
                <span>查看完整内容</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {data && totalPages > 1 ? (
        <nav className="pagination" aria-label="文本块分页">
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页
          </span>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading}
          >
            下一页
          </button>
        </nav>
      ) : null}

      {selectedChunkId ? (
        <ChunkDetailDialog
          documentId={document.id}
          chunkId={selectedChunkId}
          onClose={() => setSelectedChunkId(null)}
        />
      ) : null}
    </div>
  )
}

function ChunkDetailDialog({
  documentId,
  chunkId,
  onClose,
}: {
  documentId: string
  chunkId: string
  onClose: () => void
}) {
  const [chunk, setChunk] = useState<DocumentChunkDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true

    getDocumentChunk(documentId, chunkId)
      .then((detail) => {
        if (active) {
          setChunk(detail)
          setError(null)
          setLoading(false)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : '加载文本块详情失败',
          )
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [documentId, chunkId, attempt])

  const retry = () => {
    setLoading(true)
    setError(null)
    setAttempt((value) => value + 1)
  }

  return (
    <Modal
      labelledBy="chunk-detail-title"
      className="chunk-detail-dialog"
      onClose={onClose}
    >
      <div className="modal__header">
        <div>
          <span className="modal__eyebrow">CHUNK DETAIL</span>
          <h2 id="chunk-detail-title">
            文本块 {chunk ? `#${chunk.chunk_index + 1}` : ''}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭文本块详情"
        >
          <CloseIcon />
        </button>
      </div>

      {loading ? (
        <div className="chunk-detail-loading">
          <Spinner label="文本块加载中" />
        </div>
      ) : null}

      {error ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          <AlertIcon className="icon" />
          <div className="inline-alert__copy">
            <strong>文本块加载失败</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={retry}
          >
            重试
          </button>
        </div>
      ) : null}

      {chunk ? (
        <>
          <dl className="chunk-detail-meta">
            <div>
              <dt>页码</dt>
              <dd>{chunk.page_no ?? '—'}</dd>
            </div>
            <div>
              <dt>章节</dt>
              <dd>{chunk.section_path ?? '—'}</dd>
            </div>
            <div>
              <dt>字符数</dt>
              <dd>{chunk.char_count}</dd>
            </div>
            <div>
              <dt>哈希</dt>
              <dd>
                <code title={chunk.chunk_hash}>{chunk.chunk_hash.slice(0, 12)}…</code>
              </dd>
            </div>
          </dl>
          <pre className="chunk-detail-content">{chunk.content}</pre>
        </>
      ) : null}
    </Modal>
  )
}

/* ---------- 删除确认 ---------- */

function DeleteDocumentDialog({
  document,
  onClose,
  onDeleted,
}: {
  document: DocumentRead
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmDelete = async () => {
    setDeleting(true)
    setError(null)

    try {
      await deleteDocument(document.id)
      onDeleted()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : '删除文档失败',
      )
      setDeleting(false)
    }
  }

  return (
    <Modal
      labelledBy="delete-dialog-title"
      className="confirm-dialog"
      closeDisabled={deleting}
      onClose={onClose}
    >
      <div className="modal__header">
        <div>
          <span className="modal__eyebrow">DELETE DOCUMENT</span>
          <h2 id="delete-dialog-title">删除这份文档？</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          disabled={deleting}
          aria-label="关闭删除确认"
        >
          <CloseIcon />
        </button>
      </div>

      <p className="confirm-dialog__text">
        <strong>{document.name}</strong>{' '}
        的数据库记录与 COS 原始文件都会被删除，这个操作无法撤销。
      </p>

      {error ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          <AlertIcon className="icon" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="modal__footer">
        <button
          type="button"
          className="button button--ghost"
          onClick={onClose}
          disabled={deleting}
        >
          取消
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            void confirmDelete()
          }}
          disabled={deleting}
        >
          {deleting ? <Spinner small label="删除中" /> : <TrashIcon className="icon" />}
          {deleting ? '删除中…' : '确认删除'}
        </button>
      </div>
    </Modal>
  )
}
