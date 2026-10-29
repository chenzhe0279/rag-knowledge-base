import { useState } from 'react'
import { ExternalLinkIcon, TraceIcon } from './Icons'

interface TraceBadgeProps {
  traceId: string | null
  traceUrl: string | null
}

/**
 * LangSmith 链路入口。
 * 配置了 run URL 前缀时直接打开追踪页；否则退化为复制 trace_id。
 */
export function TraceBadge({ traceId, traceUrl }: TraceBadgeProps) {
  const [copied, setCopied] = useState(false)

  if (!traceId && !traceUrl) {
    return null
  }

  const title = traceId
    ? `LangSmith trace: ${traceId}`
    : '在 LangSmith 中查看本次链路'

  if (traceUrl) {
    return (
      <a
        className="chat-trace"
        href={traceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label="打开 LangSmith 链路追踪"
      >
        <TraceIcon className="icon" />
        <span>TRACE</span>
        <ExternalLinkIcon className="chat-trace__external" />
      </a>
    )
  }

  const copyTraceId = async () => {
    if (!traceId) {
      return
    }

    try {
      await navigator.clipboard.writeText(traceId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className={`chat-trace ${copied ? 'is-copied' : ''}`}
      onClick={() => void copyTraceId()}
      title={title}
      aria-label="复制 LangSmith trace_id"
    >
      <TraceIcon className="icon" />
      <span>{copied ? '已复制' : 'TRACE ID'}</span>
    </button>
  )
}
