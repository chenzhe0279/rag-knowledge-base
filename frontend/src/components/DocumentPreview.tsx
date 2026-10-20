import { getDocumentFileUrl } from '../api/documents'
import {
  getDocumentKind,
  getUnsupportedPreviewTitle,
  isOfficeDocument,
} from '../lib/documents'
import type { DocumentRead } from '../types/documents'
import { DownloadIcon, ExternalLinkIcon } from './Icons'
import { MarkdownView } from './MarkdownView'

interface DocumentPreviewProps {
  document: DocumentRead
}

export function DocumentPreview({ document }: DocumentPreviewProps) {
  const kind = getDocumentKind(document)
  const officeDocument = isOfficeDocument(kind)
  const previewUrl = getDocumentFileUrl(document.id)
  const downloadUrl = getDocumentFileUrl(document.id, { download: true })

  const actions = (
    <div className="preview-actions">
      <a
        className="button button--ghost button--sm"
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLinkIcon className="icon" />
        原始文件
      </a>
      <a className="button button--ghost button--sm" href={downloadUrl}>
        <DownloadIcon className="icon" />
        下载
      </a>
    </div>
  )

  if (kind === 'markdown') {
    return (
      <div className="preview-panel">
        <div className="preview-toolbar">
          <div>
            <strong>Markdown 预览</strong>
            <span>由 react-markdown 渲染 · 支持 GFM 表格与任务列表</span>
          </div>
          {actions}
        </div>
        <div className="preview-markdown-scroll">
          <MarkdownView key={document.id} documentId={document.id} />
        </div>
      </div>
    )
  }

  if (kind === 'pdf' || kind === 'html') {
    return (
      <div className="preview-panel">
        <div className="preview-toolbar">
          <div>
            <strong>{kind === 'pdf' ? 'PDF 预览' : 'HTML 预览'}</strong>
            <span>
              {kind === 'pdf'
                ? '使用浏览器内置 PDF 阅读器'
                : 'HTML 在沙箱 iframe 中渲染，脚本不会执行'}
            </span>
          </div>
          {actions}
        </div>
        <iframe
          key={`${document.id}-${document.updated_at}`}
          className="preview-frame"
          src={previewUrl}
          title={`${document.name} 预览`}
          sandbox={kind === 'html' ? '' : undefined}
        />
      </div>
    )
  }

  return (
    <div className="preview-panel preview-panel--download">
      <div className="preview-download-card">
        <span className="preview-download-card__icon">
          <DownloadIcon />
        </span>
        <h3>{getUnsupportedPreviewTitle(kind)}</h3>
        <p>
          {officeDocument
            ? '浏览器无法直接渲染 Office 文件，请下载后使用本地应用打开。'
            : '后端已保存原始文件，可以下载后使用本地应用打开。'}
          解析完成后仍然可以在「文本块」中查看提取出的内容。
        </p>
        <div className="preview-download-card__actions">
          <a className="button button--primary" href={downloadUrl}>
            <DownloadIcon className="icon" />
            下载文件
          </a>
          {officeDocument ? null : (
            <a
              className="button button--ghost"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon className="icon" />
              尝试打开
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
