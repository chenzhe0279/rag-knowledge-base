import { useState } from 'react'
import {
  AlertIcon,
  ChevronRightIcon,
  PencilIcon,
  RefreshIcon,
  UploadIcon,
} from '../components/Icons'
import { DocumentThumbnail } from '../components/DocumentThumbnail'
import { RenameDocumentDialog } from '../components/RenameDocumentDialog'
import { StatusBadge } from '../components/StatusBadge'
import { UploadDialog } from '../components/UploadDialog'
import { useDocumentLibrary } from '../hooks/useDocumentLibrary'
import {
  DOCUMENT_STATUS_META,
  getDocumentKind,
  getDocumentKindLabel,
  isProcessingStatus,
} from '../lib/documents'
import { formatBytes, formatDateTime } from '../lib/format'
import type { DocumentRead, DocumentStatus } from '../types/documents'
import './DocumentsPage.css'

interface DocumentsPageProps {
  onOpenDocument: (documentId: string) => void
}

export function DocumentsPage({ onOpenDocument }: DocumentsPageProps) {
  const {
    documents,
    total,
    page,
    pageSize,
    status,
    loading,
    refreshing,
    error,
    setPage,
    setStatus,
    refresh,
    replaceDocument,
  } = useDocumentLibrary()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DocumentRead | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasFilter = status !== null

  return (
    <main className="library-page">
      <section className="library-hero" aria-labelledby="library-hero-title">
        <div className="library-hero__copy">
          <p className="eyebrow">
            <span className="eyebrow__mark" aria-hidden="true" />
            KNOWLEDGE LIBRARY
          </p>
          <h1 id="library-hero-title">
            知识库
            <br />
            <span>文档库</span>
          </h1>
          <p className="hero__lead">
            上传 PDF、Word、PowerPoint、Excel、Markdown 或 HTML 文档，后端会自动完成解析、切分与向量化。
            文档就绪后即可在这里预览原文、查看文本块和排查处理结果。
          </p>
        </div>

        <div className="library-hero__aside">
          <div className="library-count">
            <strong>{total}</strong>
            <span>份文档已收录</span>
            <small>
              {documents.some((document) => isProcessingStatus(document.status))
                ? '当前页有文档正在处理'
                : '当前页处理状态稳定'}
            </small>
          </div>
          <button
            type="button"
            className="button button--primary library-upload-button"
            onClick={() => setUploadOpen(true)}
          >
            <UploadIcon className="icon" />
            上传文档
          </button>
        </div>
      </section>

      <section className="library-panel" aria-labelledby="library-title">
        <div className="library-toolbar">
          <div>
            <h2 id="library-title">
              {hasFilter && status ? DOCUMENT_STATUS_META[status].label : '全部文档'}
            </h2>
            <p>
              {loading
                ? '正在加载文档列表…'
                : `共 ${total} 个文档 · 第 ${page} / ${totalPages} 页`}
            </p>
          </div>

          <div className="library-toolbar__actions">
            <label className="select-control">
              <span className="visually-hidden">按文档状态筛选</span>
              <select
                value={status ?? 'all'}
                onChange={(event) => {
                  const value = event.target.value
                  setStatus(value === 'all' ? null : (value as DocumentStatus))
                }}
              >
                <option value="all">全部状态</option>
                {(Object.keys(DOCUMENT_STATUS_META) as DocumentStatus[]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {DOCUMENT_STATUS_META[value].label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={refresh}
              disabled={refreshing || loading}
            >
              <RefreshIcon
                className={refreshing ? 'icon icon--spinning' : 'icon'}
              />
              刷新
            </button>
          </div>
        </div>

        {error ? (
          <div className="inline-alert inline-alert--danger" role="alert">
            <AlertIcon className="icon" />
            <div className="inline-alert__copy">
              <strong>文档列表加载失败</strong>
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

        {loading ? (
          <DocumentListSkeleton />
        ) : documents.length === 0 ? (
          error ? null : (
            <div className="library-empty">
              <span className="library-empty__icon">
                <UploadIcon />
              </span>
              <h3>{hasFilter ? '当前筛选下没有文档' : '知识库还是空的'}</h3>
              <p>
                {hasFilter
                  ? '换一个状态筛选，或者上传一份新文档。'
                  : '上传第一份文档，后端会自动解析、切分并生成向量，完成后可在这里预览。'}
              </p>
              {hasFilter ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setStatus(null)}
                >
                  清除筛选
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setUploadOpen(true)}
                >
                  <UploadIcon className="icon" />
                  上传第一份文档
                </button>
              )}
            </div>
          )
        ) : (
          <ul className="knowledge-grid">
            {documents.map((document) => {
              const meta = DOCUMENT_STATUS_META[document.status]
              const kind = getDocumentKind(document)

              return (
                <li key={document.id}>
                  <article className="knowledge-card">
                    <div className="knowledge-card__media">
                      <DocumentThumbnail
                        key={`${document.id}-${document.updated_at}`}
                        document={document}
                      />
                      <span className="knowledge-card__badge">
                        <StatusBadge tone={meta.tone} pulse={meta.processing}>
                          {meta.label}
                        </StatusBadge>
                      </span>
                      <button
                        type="button"
                        className="knowledge-card__media-hit"
                        onClick={() => onOpenDocument(document.id)}
                        aria-label={`打开 ${document.name}`}
                      />
                    </div>

                    <div className="knowledge-card__body">
                      <button
                        type="button"
                        className="knowledge-card__title"
                        onClick={() => onOpenDocument(document.id)}
                        title={document.name}
                      >
                        {document.name}
                      </button>
                      <p className="knowledge-card__meta">
                        <span>{getDocumentKindLabel(kind)}</span>
                        <span>{formatBytes(document.size)}</span>
                      </p>
                      {document.status === 'failed' && document.error_message ? (
                        <p
                          className="knowledge-card__error"
                          title={document.error_message}
                        >
                          {document.error_message}
                        </p>
                      ) : null}
                    </div>

                    <div className="knowledge-card__footer">
                      <span className="knowledge-card__date">
                        {formatDateTime(document.updated_at)}
                      </span>
                      <div className="knowledge-card__actions">
                        <button
                          type="button"
                          className="card-action"
                          onClick={() => setRenameTarget(document)}
                        >
                          <PencilIcon className="icon" />
                          重命名
                        </button>
                        <button
                          type="button"
                          className="card-action card-action--open"
                          onClick={() => onOpenDocument(document.id)}
                        >
                          查看
                          <ChevronRightIcon className="icon" />
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        )}

        {!loading && totalPages > 1 ? (
          <nav className="pagination" aria-label="文档分页">
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1 || refreshing}
            >
              上一页
            </button>
            <span>
              第 {page} / {totalPages} 页
            </span>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages || refreshing}
            >
              下一页
            </button>
          </nav>
        ) : null}
      </section>

      {uploadOpen ? (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={(document) => {
            setUploadOpen(false)
            onOpenDocument(document.id)
          }}
        />
      ) : null}

      {renameTarget ? (
        <RenameDocumentDialog
          document={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={(updated) => {
            setRenameTarget(null)
            replaceDocument(updated)
          }}
        />
      ) : null}
    </main>
  )
}

function DocumentListSkeleton() {
  return (
    <div className="knowledge-grid knowledge-grid--loading" aria-label="文档加载中">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="knowledge-card knowledge-card--skeleton" key={index}>
          <span className="skeleton-block knowledge-card__skeleton-media" />
          <div className="knowledge-card__body">
            <span className="skeleton-block skeleton-block--name" />
            <span className="skeleton-block skeleton-block--meta" />
          </div>
          <div className="knowledge-card__footer">
            <span className="skeleton-block skeleton-block--date" />
            <span className="skeleton-block skeleton-block--badge" />
          </div>
        </div>
      ))}
    </div>
  )
}
