import type { ChatCitation, RetrievalMeta } from '../types/chat'

export type RetrievalSourceKind = 'vector' | 'keyword' | 'hybrid' | 'unknown'

/** 根据 sources 判断这条引用命中了哪条（或哪两条）检索路。 */
export function getRetrievalSourceKind(
  meta?: RetrievalMeta | null,
): RetrievalSourceKind {
  const sources = meta?.sources ?? []
  const hasVector = sources.includes('vector')
  const hasKeyword = sources.includes('keyword')

  if (hasVector && hasKeyword) {
    return 'hybrid'
  }
  if (hasVector) {
    return 'vector'
  }
  if (hasKeyword) {
    return 'keyword'
  }
  return 'unknown'
}

export function getRetrievalSourceLabel(kind: RetrievalSourceKind): string {
  switch (kind) {
    case 'hybrid':
      return '双路'
    case 'vector':
      return '向量'
    case 'keyword':
      return '关键词'
    default:
      return '未知'
  }
}

export function formatRetrievalScore(
  value: number | null | undefined,
  digits = 3,
): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : '—'
}

export function formatRetrievalRank(value: number | null | undefined): string {
  return typeof value === 'number' ? `#${value}` : '—'
}

/** 拼一条引用调试摘要，用于 title 悬浮提示。 */
export function formatCitationMeta(citation: ChatCitation): string {
  const meta = citation.retrieval_meta
  if (!meta) {
    return ''
  }

  const kind = getRetrievalSourceKind(meta)
  const parts = [`来源：${getRetrievalSourceLabel(kind)}`]

  if (meta.vector_rank !== null || meta.vector_score !== null) {
    parts.push(
      `向量 ${formatRetrievalRank(meta.vector_rank)} / ${formatRetrievalScore(
        meta.vector_score,
        3,
      )}`,
    )
  }

  if (meta.keyword_rank !== null || meta.keyword_score !== null) {
    parts.push(
      `关键词 ${formatRetrievalRank(meta.keyword_rank)} / ${formatRetrievalScore(
        meta.keyword_score,
        3,
      )}`,
    )
  }

  if (meta.rrf_score !== null) {
    parts.push(`RRF ${formatRetrievalScore(meta.rrf_score, 4)}`)
  }

  return parts.join(' · ')
}
