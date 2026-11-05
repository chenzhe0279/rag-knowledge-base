import { useEffect, useState } from 'react'
import { fetchDocumentText, getDocumentFileUrl } from '../../api/documents'
import { errorMessage, isAbortError } from '../../api/http'
import { DownloadIcon, FileIcon, LayersIcon } from '../../components/Icons'
import { MarkdownView } from '../../components/MarkdownView'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { FILE_KIND_LABEL, fileKindFromMime } from '../../lib/documents'
import type { DocumentRead } from '../../types/api'

interface PreviewPanelProps {
  document: DocumentRead
  onShowChunks: () => void
}

export function PreviewPanel({ document, onShowChunks }: PreviewPanelProps) {
  const kind = fileKindFromMime(document.mime_type)

  if (kind === 'markdown') return <MarkdownPreview documentId={document.id} />

  if (kind === 'pdf' || kind === 'html') {
    const src = getDocumentFileUrl(document.id)
    return (
      <div className="preview-frame">
        <iframe
          title={`${document.name} 预览`}
          src={src}
          // HTML 原文禁止脚本执行；PDF 需要浏览器内置阅读器，不能加 sandbox
          sandbox={kind === 'html' ? '' : undefined}
          loading="lazy"
        />
      </div>
    )
  }

  return (
    <EmptyState
      icon={<FileIcon size={26} />}
      title={`${FILE_KIND_LABEL[kind]} 暂不支持在线预览`}
      description="浏览器无法直接渲染 Office 文档，可以下载原文件查看，或在「文本块」中查看解析后的内容。"
      action={
        <div className="preview-fallback__actions">
          <a
            className="btn btn--primary"
            href={getDocumentFileUrl(document.id, { download: true })}
            download={document.name}
          >
            <DownloadIcon size={16} />
            下载原文件
          </a>
          <button type="button" className="btn" onClick={onShowChunks}>
            <LayersIcon size={16} />
            查看文本块
          </button>
        </div>
      }
    />
  )
}

function MarkdownPreview({ documentId }: { documentId: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchDocumentText(documentId, controller.signal)
      .then((content) => {
        setText(content)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!isAbortError(caught)) setError(errorMessage(caught, '原文加载失败'))
      })
    return () => controller.abort()
  }, [documentId, attempt])

  function retry() {
    setError(null)
    setText(null)
    setAttempt((value) => value + 1)
  }

  if (error) return <ErrorState message={error} onRetry={retry} />

  if (text === null) {
    return (
      <div className="preview-skeleton" aria-busy="true">
        <Skeleton height={26} width="48%" />
        <Skeleton height={14} />
        <Skeleton height={14} width="92%" />
        <Skeleton height={14} width="76%" />
        <Skeleton height={120} />
      </div>
    )
  }

  if (!text.trim()) {
    return (
      <EmptyState icon={<FileIcon size={26} />} title="文件内容为空" description="该 Markdown 文件没有可显示的内容。" />
    )
  }

  return (
    <div className="preview-markdown">
      <MarkdownView content={text} />
    </div>
  )
}
