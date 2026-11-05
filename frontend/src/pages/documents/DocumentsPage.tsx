import { useCallback, useEffect, useRef, useState } from 'react'
import { listDocuments, resolveThumbnailUrl } from '../../api/documents'
import { errorMessage, isAbortError } from '../../api/http'
import { Link } from '../../app/Link'
import { navigate, paths } from '../../app/router'
import { useSession } from '../../auth/useAuth'
import { RenameDocumentDialog } from '../../components/documents/RenameDocumentDialog'
import { UploadDocumentDialog } from '../../components/documents/UploadDocumentDialog'
import { FileThumb } from '../../components/FileThumb'
import { FileIcon, FilterIcon, PencilIcon, RefreshIcon, UploadIcon } from '../../components/Icons'
import { Pagination } from '../../components/Pagination'
import { ProgressBar } from '../../components/ProgressBar'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { DocumentStatusBadge, TaskStatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../components/toast/useToast'
import { usePolling } from '../../hooks/usePolling'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import {
  DOCUMENT_STATUS_OPTIONS,
  FILE_KIND_LABEL,
  fileKindFromMime,
  isDocumentProcessing,
  isTaskActive,
  permissionScopeText,
  TASK_TYPE_LABEL,
} from '../../lib/documents'
import { formatBytes, formatNumber, formatRelative, percentOf } from '../../lib/format'
import type { DocumentRead, DocumentStatus, Page } from '../../types/api'
import './DocumentsPage.css'

const PAGE_SIZE = 12
const POLL_INTERVAL = 3000

export function DocumentsPage() {
  useDocumentTitle('文档库')
  const { isAdmin } = useSession()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<DocumentStatus | null>(null)
  const [data, setData] = useState<Page<DocumentRead> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [renaming, setRenaming] = useState<DocumentRead | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      if (!options.silent) setLoading(true)
      try {
        const result = await listDocuments({ page, pageSize: PAGE_SIZE, status }, controller.signal)
        // 删除后当前页可能越界，回退到最后一页
        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setData(result)
        setError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        // 轮询失败时保留已有数据，只在首次加载时显示错误
        if (!options.silent) setError(errorMessage(caught, '文档列表加载失败'))
      } finally {
        if (controllerRef.current === controller) setLoading(false)
      }
    },
    [page, status],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [load])

  const hasProcessing = Boolean(data?.items.some(isDocumentProcessing))
  usePolling(() => void load({ silent: true }), POLL_INTERVAL, hasProcessing)

  function changeStatus(next: DocumentStatus | null) {
    setStatus(next)
    setPage(1)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const showSkeleton = loading && !data

  return (
    <main className="page">
      <section className="page-hero">
        <div className="page-hero__copy">
          <span className="eyebrow">Knowledge Library</span>
          <h1 className="hero-title">
            知识库
            <span>文档库</span>
          </h1>
          <p className="hero-lead">
            管理进入检索链路的全部文档：解析、切分、向量化由 Celery Worker 异步完成，权限标签决定谁能在问答中看到它。
          </p>
        </div>
        <div className="page-hero__aside">
          <div className="dark-block docs-count">
            <span className="eyebrow">Visible documents</span>
            <strong className="docs-count__value num">
              {data ? formatNumber(total) : '—'}
            </strong>
            <span className="docs-count__label">
              {status ? '当前筛选下的文档' : '当前账号可见的文档总数'}
            </span>
            {isAdmin ? (
              <button type="button" className="btn btn--primary" onClick={() => setUploadOpen(true)}>
                <UploadIcon size={16} />
                上传文档
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="glass glass--pad" aria-labelledby="docs-panel-title">
        <div className="panel-head">
          <div className="panel-head__title">
            <h2 id="docs-panel-title" className="section-title">
              全部文档
            </h2>
            <span className="muted">
              {data ? (
                <>
                  共 <span className="num">{total}</span> 个文档
                  {hasProcessing ? ' · 有文档正在处理，每 3 秒自动刷新' : ''}
                </>
              ) : (
                '正在加载…'
              )}
            </span>
          </div>
          <div className="panel-head__actions">
            <div className="segmented docs-filter" role="tablist" aria-label="按状态筛选">
              {DOCUMENT_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="tab"
                  aria-selected={status === option.value}
                  onClick={() => changeStatus(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void load()}
              disabled={loading}
              aria-label="刷新文档列表"
              title="刷新"
            >
              <RefreshIcon size={16} className={loading ? 'spin' : undefined} />
            </button>
          </div>
        </div>

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {showSkeleton ? (
          <div className="docs-grid" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="doc-card soft-card">
                <Skeleton height="auto" className="doc-card__skeleton-cover" />
                <div className="doc-card__body">
                  <Skeleton height={18} width="70%" />
                  <Skeleton height={12} width="45%" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!showSkeleton && !error && items.length === 0 ? (
          status ? (
            <EmptyState
              icon={<FilterIcon size={26} />}
              title="没有符合筛选条件的文档"
              description="换一个状态看看，或清除筛选查看全部文档。"
              action={
                <button type="button" className="btn" onClick={() => changeStatus(null)}>
                  清除筛选
                </button>
              }
            />
          ) : isAdmin ? (
            <EmptyState
              icon={<UploadIcon size={26} />}
              title="上传第一份文档"
              description="支持 PDF、Word、PPT、Excel、Markdown、HTML，上传后自动入库。"
              action={
                <button type="button" className="btn btn--primary" onClick={() => setUploadOpen(true)}>
                  <UploadIcon size={16} />
                  上传文档
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={<FileIcon size={26} />}
              title="暂无可见文档"
              description="当前账号还没有可见文档，请联系管理员分配文档权限。"
            />
          )
        ) : null}

        {items.length > 0 ? (
          <div className="docs-grid">
            {items.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                canEdit={isAdmin}
                onRename={() => setRenaming(document)}
              />
            ))}
          </div>
        ) : null}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
          disabled={loading}
          unit="个文档"
        />
      </section>

      {isAdmin ? (
        <UploadDocumentDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={(document) => {
            setUploadOpen(false)
            toast.success(`「${document.name}」已提交入库`)
            navigate(paths.document(document.id))
          }}
        />
      ) : null}

      {renaming ? (
        <RenameDocumentDialog
          key={renaming.id}
          document={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(updated) => {
            setRenaming(null)
            setData((current) =>
              current
                ? {
                    ...current,
                    items: current.items.map((item) => (item.id === updated.id ? updated : item)),
                  }
                : current,
            )
            toast.success('文档已重命名')
          }}
        />
      ) : null}
    </main>
  )
}

function DocumentCard({
  document,
  canEdit,
  onRename,
}: {
  document: DocumentRead
  canEdit: boolean
  onRename: () => void
}) {
  const kind = fileKindFromMime(document.mime_type)
  const task = document.latest_task
  const showTask = task && task.status !== 'success'
  const taskProgress =
    task && task.progress_total > 0 ? percentOf(task.progress_done, task.progress_total) : null

  return (
    <article className="doc-card soft-card">
      <Link
        to={paths.document(document.id)}
        className="doc-card__link"
        aria-label={`查看文档 ${document.name}`}
      />
      <div className="doc-card__cover">
        <FileThumb kind={kind} src={resolveThumbnailUrl(document)} />
        <DocumentStatusBadge status={document.status} className="doc-card__status" />
      </div>
      <div className="doc-card__body">
        <h3 className="doc-card__name clamp-2" title={document.name}>
          {document.name}
        </h3>
        <p className="doc-card__meta">
          <span>{FILE_KIND_LABEL[kind]}</span>
          <span className="num">{formatBytes(document.size)}</span>
          <span className="num">v{document.version}</span>
          <span>{formatRelative(document.updated_at)}</span>
        </p>
        <p className="doc-card__scope faint">
          可见范围：{permissionScopeText(document.permission_tags)}
        </p>

        {showTask ? (
          <div className="doc-card__task">
            <div className="doc-card__task-head">
              <span>{TASK_TYPE_LABEL[task.task_type]}</span>
              <TaskStatusBadge status={task.status} />
            </div>
            {isTaskActive(task) ? (
              <ProgressBar
                value={task.status === 'pending' ? null : taskProgress}
                label={`${TASK_TYPE_LABEL[task.task_type]}进度`}
              />
            ) : null}
            {task.status === 'failed' && task.error_message ? (
              <p className="doc-card__error clamp-2" title={task.error_message}>
                {task.error_message}
              </p>
            ) : null}
          </div>
        ) : document.status === 'failed' && document.error_message ? (
          <p className="doc-card__error clamp-2" title={document.error_message}>
            {document.error_message}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <button
          type="button"
          className="icon-btn doc-card__rename"
          onClick={onRename}
          aria-label={`重命名 ${document.name}`}
          title="重命名"
        >
          <PencilIcon size={15} />
        </button>
      ) : null}
    </article>
  )
}
