import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocumentChunk, listDocumentChunks } from '../../api/documents'
import { errorMessage, isAbortError } from '../../api/http'
import { ChevronDownIcon, LayersIcon } from '../../components/Icons'
import { Pagination } from '../../components/Pagination'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { formatNumber, shortHash } from '../../lib/format'
import type { DocumentChunk, DocumentChunkPage, DocumentRead } from '../../types/api'

const PAGE_SIZE = 10

interface ChunkPanelProps {
  document: DocumentRead
  processing: boolean
}

export function ChunkPanel({ document, processing }: ChunkPanelProps) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<DocumentChunkPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    try {
      setData(await listDocumentChunks(document.id, page, PAGE_SIZE, controller.signal))
      setError(null)
    } catch (caught) {
      if (isAbortError(caught)) return
      setError(errorMessage(caught, '文本块加载失败'))
    } finally {
      if (controllerRef.current === controller) setLoading(false)
    }
  }, [document.id, page])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [load])

  const stats = data?.stats

  return (
    <div className="chunk-panel">
      <dl className="chunk-stats">
        <ChunkStat label="文本块总数" value={stats ? formatNumber(stats.total) : '—'} />
        <ChunkStat
          label="平均长度"
          value={stats ? `${formatNumber(Math.round(stats.avg_length))} 字` : '—'}
        />
        <ChunkStat label="最短" value={stats ? `${formatNumber(stats.min_length)} 字` : '—'} />
        <ChunkStat label="最长" value={stats ? `${formatNumber(stats.max_length)} 字` : '—'} />
      </dl>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {loading && !data ? (
        <div className="chunk-list" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={92} radius={16} />
          ))}
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          icon={<LayersIcon size={26} />}
          title={processing ? '文本块生成中' : '暂无文本块'}
          description={
            processing
              ? 'Worker 正在解析与切分文档，完成后这里会显示切分结果。'
              : '该文档没有生成文本块，可能解析失败或内容为空。'
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <ol className="chunk-list" aria-busy={loading}>
          {data.items.map((chunk) => (
            <ChunkItem key={chunk.id} documentId={document.id} chunk={chunk} />
          ))}
        </ol>
      ) : null}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={data?.total ?? 0}
        onChange={setPage}
        disabled={loading}
        unit="个文本块"
      />
    </div>
  )
}

function ChunkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="chunk-stats__item">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}

function ChunkItem({ documentId, chunk }: { documentId: string; chunk: DocumentChunk }) {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (content !== null) return
    setLoading(true)
    setError(null)
    try {
      const detail = await getDocumentChunk(documentId, chunk.id)
      setContent(detail.content)
    } catch (caught) {
      setError(errorMessage(caught, '完整内容加载失败'))
    } finally {
      setLoading(false)
    }
  }

  const bodyId = `chunk-body-${chunk.id}`

  return (
    <li className="chunk-item" data-expanded={expanded || undefined}>
      <div className="chunk-item__head">
        <span className="chunk-item__index num">#{chunk.chunk_index + 1}</span>
        <div className="chunk-item__meta">
          {chunk.page_no !== null && chunk.page_no !== undefined ? (
            <span className="chip">第 {chunk.page_no} 页</span>
          ) : null}
          <span className="chip">{formatNumber(chunk.char_count)} 字</span>
          <span className="chip" title={chunk.chunk_hash}>
            {shortHash(chunk.chunk_hash)}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm chunk-item__toggle"
          onClick={() => void toggle()}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          {expanded ? '收起' : '展开全文'}
          <ChevronDownIcon size={14} />
        </button>
      </div>
      {chunk.section_path ? (
        <p className="chunk-item__section" title={chunk.section_path}>
          {chunk.section_path}
        </p>
      ) : null}
      <div id={bodyId} className="chunk-item__body">
        {expanded && loading ? <Skeleton height={60} /> : null}
        {expanded && error ? <ErrorState message={error} /> : null}
        {expanded && content !== null ? (
          <p className="chunk-item__content">{content}</p>
        ) : !expanded ? (
          <p className="chunk-item__excerpt">{chunk.content_excerpt}</p>
        ) : null}
      </div>
    </li>
  )
}
