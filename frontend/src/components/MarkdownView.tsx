import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchMarkdownText } from '../api/documents'
import { AlertIcon, RefreshIcon } from './Icons'

interface MarkdownViewProps {
  documentId: string
}

export function MarkdownView({ documentId }: MarkdownViewProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true

    fetchMarkdownText(documentId)
      .then((text) => {
        if (!active) {
          return
        }
        setContent(text)
        setError(null)
        setLoading(false)
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return
        }
        setError(
          loadError instanceof Error ? loadError.message : '加载 Markdown 失败',
        )
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [documentId, attempt])

  const retry = () => {
    setLoading(true)
    setError(null)
    setAttempt((value) => value + 1)
  }

  if (loading) {
    return (
      <div className="markdown-skeleton" aria-label="Markdown 加载中">
        <span className="markdown-skeleton__title" />
        <span />
        <span />
        <span className="markdown-skeleton__short" />
        <span className="markdown-skeleton__heading" />
        <span />
        <span className="markdown-skeleton__short" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="preview-error" role="alert">
        <AlertIcon className="icon" />
        <div>
          <strong>Markdown 读取失败</strong>
          <p>{error}</p>
        </div>
        <button type="button" className="button button--ghost button--sm" onClick={retry}>
          <RefreshIcon className="icon" />
          重试
        </button>
      </div>
    )
  }

  if (!content.trim()) {
    return <div className="preview-empty">这个 Markdown 文件没有可显示的正文。</div>
  }

  return (
    <article className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  )
}
