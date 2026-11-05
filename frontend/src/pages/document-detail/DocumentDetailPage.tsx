import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteDocument,
  getDocument,
  getDocumentFileUrl,
  resolveThumbnailUrl,
  retryDocument,
} from '../../api/documents'
import { ApiError, errorMessage, isAbortError } from '../../api/http'
import { Link } from '../../app/Link'
import { navigate, paths } from '../../app/router'
import { useSession } from '../../auth/useAuth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PermissionTagsDialog } from '../../components/documents/PermissionTagsDialog'
import { ReindexDocumentDialog } from '../../components/documents/ReindexDocumentDialog'
import { RenameDocumentDialog } from '../../components/documents/RenameDocumentDialog'
import { ThumbnailDialog } from '../../components/documents/ThumbnailDialog'
import { FileThumb } from '../../components/FileThumb'
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
  LayersIcon,
  PencilIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
  UploadIcon,
} from '../../components/Icons'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { DocumentStatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../components/toast/useToast'
import { usePolling } from '../../hooks/usePolling'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import {
  FILE_KIND_LABEL,
  fileKindFromMime,
  isDocumentProcessing,
  isTaskActive,
  permissionScopeText,
} from '../../lib/documents'
import { formatBytes, formatDateTime, formatRelative, shortHash } from '../../lib/format'
import type { DocumentRead } from '../../types/api'
import { ChunkPanel } from './ChunkPanel'
import { PreviewPanel } from './PreviewPanel'
import { TaskCard } from './TaskCard'
import './DocumentDetailPage.css'

const POLL_INTERVAL = 2500

type DetailTab = 'preview' | 'chunks'
type DialogName = 'rename' | 'permissions' | 'reindex' | 'thumbnail' | 'delete'

export function DocumentDetailPage({ documentId }: { documentId: string }) {
  const { isAdmin } = useSession()
  const toast = useToast()
  const [document, setDocument] = useState<DocumentRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null)
  const [tab, setTab] = useState<DetailTab>('preview')
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [retrying, setRetrying] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  useDocumentTitle(document?.name ?? '文档详情')

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      if (!options.silent) setLoading(true)
      try {
        setDocument(await getDocument(documentId, controller.signal))
        setError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        if (!options.silent) {
          setError({
            message: errorMessage(caught, '文档详情加载失败'),
            notFound: caught instanceof ApiError && caught.status === 404,
          })
        }
      } finally {
        if (controllerRef.current === controller) setLoading(false)
      }
    },
    [documentId],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [load])

  const processing = document ? isDocumentProcessing(document) : false
  usePolling(() => void load({ silent: true }), POLL_INTERVAL, processing)

  function applyUpdate(updated: DocumentRead, message: string) {
    setDialog(null)
    setDocument(updated)
    toast.success(message)
  }

  async function handleRetry() {
    if (!document) return
    setRetrying(true)
    try {
      setDocument(await retryDocument(document.id))
      toast.success('已重新提交处理任务')
    } catch (caught) {
      toast.error(errorMessage(caught, '重新处理失败'))
    } finally {
      setRetrying(false)
    }
  }

  async function handleDelete() {
    if (!document) return
    await deleteDocument(document.id)
    toast.success(`「${document.name}」已删除`)
    navigate(paths.documents(), { replace: true })
  }

  if (error && !document) {
    return (
      <main className="page">
        <BackLink />
        <section className="glass glass--pad">
          {error.notFound ? (
            <EmptyState
              icon={<FileIcon size={26} />}
              title="文档不存在或无权访问"
              description="文档可能已被删除，或当前账号没有该文档的可见权限。"
              action={
                <Link to={paths.documents()} className="btn btn--primary">
                  返回文档库
                </Link>
              }
            />
          ) : (
            <ErrorState message={error.message} onRetry={() => void load()} />
          )}
        </section>
      </main>
    )
  }

  if (!document) {
    return (
      <main className="page" aria-busy={loading}>
        <BackLink />
        <section className="glass glass--pad detail-header">
          <Skeleton width={64} height={64} radius={18} />
          <div className="detail-header__main">
            <Skeleton height={30} width="55%" />
            <Skeleton height={14} width="35%" />
            <Skeleton height={56} />
          </div>
        </section>
        <div className="detail-grid">
          <Skeleton height={420} radius={28} />
          <Skeleton height={260} radius={28} />
        </div>
      </main>
    )
  }

  const kind = fileKindFromMime(document.mime_type)
  const task = document.latest_task
  // 后端仅允许 ready/failed 且无活动任务时重新索引 / 删除
  const locked = processing || isTaskActive(task)

  return (
    <main className="page">
      <div className="detail-top">
        <BackLink />
        <div className="detail-actions">
          <a
            className="btn btn--sm"
            href={getDocumentFileUrl(document.id, { download: true })}
            download={document.name}
          >
            <DownloadIcon size={15} />
            下载
          </a>
          {isAdmin ? (
            <>
              <button type="button" className="btn btn--sm" onClick={() => setDialog('permissions')}>
                <ShieldIcon size={15} />
                可见范围
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setDialog('reindex')}
                disabled={locked}
                title={locked ? '文档处理中，请等待完成或失败后再重新索引' : undefined}
              >
                <UploadIcon size={15} />
                上传新版本
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setDialog('rename')}>
                <PencilIcon size={15} />
                重命名
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setDialog('thumbnail')}>
                <ImageIcon size={15} />
                更换封面
              </button>
              {document.status === 'failed' ? (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  onClick={() => void handleRetry()}
                  disabled={retrying || isTaskActive(task)}
                >
                  {retrying ? (
                    <span className="spinner spinner--sm" aria-hidden="true" />
                  ) : (
                    <RefreshIcon size={15} />
                  )}
                  重新处理
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--sm btn--danger-ghost"
                onClick={() => setDialog('delete')}
                disabled={locked}
                title={locked ? '文档处理中，请等待完成或失败后再删除' : undefined}
              >
                <TrashIcon size={15} />
                删除
              </button>
            </>
          ) : null}
        </div>
      </div>

      <section className="glass glass--pad detail-header" aria-labelledby="detail-title">
        <FileThumb kind={kind} src={resolveThumbnailUrl(document)} variant="tile" />
        <div className="detail-header__main">
          <div className="detail-header__title">
            <h1 id="detail-title">{document.name}</h1>
            <DocumentStatusBadge status={document.status} />
          </div>
          <p className="detail-header__meta">
            <span>{FILE_KIND_LABEL[kind]}</span>
            <span className="num">{formatBytes(document.size)}</span>
            <span>上传于 {formatDateTime(document.created_at)}</span>
            {processing ? <span className="detail-header__live">每 2.5 秒自动刷新</span> : null}
          </p>
          {document.status === 'failed' && document.error_message ? (
            <ErrorState message={document.error_message} />
          ) : null}
          <dl className="facts detail-facts">
            <div>
              <dt>ID</dt>
              <dd className="mono">{document.id}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd title={formatDateTime(document.updated_at)}>{formatRelative(document.updated_at)}</dd>
            </div>
            <div>
              <dt>文件哈希</dt>
              <dd className="mono" title={document.file_hash}>
                {shortHash(document.file_hash)}
              </dd>
            </div>
            <div>
              <dt>可见范围</dt>
              <dd>{permissionScopeText(document.permission_tags)}</dd>
            </div>
            <div>
              <dt>内容版本</dt>
              <dd className="num">v{document.version}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="detail-grid">
        <section className="glass glass--pad detail-content" aria-label="文档内容">
          <div className="panel-head">
            <div className="tabs" role="tablist" aria-label="文档内容视图">
              <button
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === 'preview'}
                onClick={() => setTab('preview')}
              >
                预览
              </button>
              <button
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === 'chunks'}
                onClick={() => setTab('chunks')}
              >
                文本块
              </button>
            </div>
          </div>
          {tab === 'preview' ? (
            <PreviewPanel
              key={document.version}
              document={document}
              onShowChunks={() => setTab('chunks')}
            />
          ) : (
            <ChunkPanel
              key={`${document.version}-${document.status}`}
              document={document}
              processing={processing}
            />
          )}
        </section>

        <aside className="detail-aside">
          <TaskCard task={task} />
          <div className="soft-card detail-tip">
            <LayersIcon size={18} />
            <p>
              问答检索只会命中「已就绪」文档的文本块；可见范围决定哪些角色能在检索结果中看到它。
            </p>
          </div>
        </aside>
      </div>

      {dialog === 'rename' ? (
        <RenameDocumentDialog
          document={document}
          onClose={() => setDialog(null)}
          onRenamed={(updated) => applyUpdate(updated, '文档已重命名')}
        />
      ) : null}
      {dialog === 'permissions' ? (
        <PermissionTagsDialog
          document={document}
          onClose={() => setDialog(null)}
          onSaved={(updated) => applyUpdate(updated, '可见范围已更新')}
        />
      ) : null}
      {dialog === 'reindex' ? (
        <ReindexDocumentDialog
          document={document}
          locked={locked}
          onClose={() => setDialog(null)}
          onSubmitted={(updated) => applyUpdate(updated, '新版本已提交，正在增量重建')}
        />
      ) : null}
      {dialog === 'thumbnail' ? (
        <ThumbnailDialog
          document={document}
          onClose={() => setDialog(null)}
          onSaved={(updated) => applyUpdate(updated, '封面已更新')}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === 'delete'}
        title="删除文档"
        description={
          <>
            确认删除「{document.name}」？原文件、缩略图与全部文本块会被一并移除，此操作不可恢复。
          </>
        }
        confirmLabel="确认删除"
        onConfirm={handleDelete}
        onClose={() => setDialog(null)}
      />
    </main>
  )
}

function BackLink() {
  return (
    <Link to={paths.documents()} className="btn btn--ghost btn--sm detail-back">
      <ArrowLeftIcon size={15} />
      返回文档库
    </Link>
  )
}
