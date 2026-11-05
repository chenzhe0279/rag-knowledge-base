import type {
  ChatCitation,
  ChatMessage,
  CitationRead,
  MessageRead,
  RetrievalFilters,
  StreamCitation,
} from '../../types/api'

export const QUESTION_MAX_LENGTH = 2000
export const FILTER_MAX_MIME_TYPES = 20
export const FILTER_MAX_DOCUMENTS = 200

let localSeq = 0

/** 本地消息 key：不依赖 crypto.randomUUID，局域网 http 访问时同样可用。 */
export function createClientKey(prefix: 'u' | 'a'): string {
  localSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${localSeq}`
}

export function citationFromRead(citation: CitationRead): ChatCitation {
  return {
    key: citation.id,
    ordinal: citation.ordinal,
    documentId: citation.document_id ?? null,
    chunkId: citation.chunk_id ?? null,
    documentName: citation.document_name,
    pageNo: citation.page_no ?? null,
    sectionPath: null,
    quote: citation.quote,
    meta: citation.retrieval_meta ?? null,
  }
}

export function citationFromStream(citation: StreamCitation, index: number): ChatCitation {
  return {
    key: `${citation.ordinal}-${citation.chunk_id ?? index}`,
    ordinal: citation.ordinal,
    documentId: citation.document_id,
    chunkId: citation.chunk_id,
    documentName: citation.document_name,
    pageNo: citation.page_no,
    sectionPath: citation.section_path ?? null,
    quote: citation.quote,
    meta: citation.retrieval_meta ?? null,
  }
}

export function messageFromRead(message: MessageRead): ChatMessage {
  return {
    clientKey: message.id,
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    status: 'done',
    citations: (message.citations ?? []).map(citationFromRead),
    queryRoute: message.query_route ?? null,
    agentSteps: message.agent_steps ?? null,
    verifyResult: message.verify_result ?? null,
    traceId: message.trace_id ?? null,
    traceUrl: message.trace_url ?? null,
    cacheHit: message.cache_hit,
    refused: false,
    errorMessage: null,
  }
}

export function createUserMessage(content: string): ChatMessage {
  return {
    ...emptyMessage(createClientKey('u'), 'user'),
    content,
    status: 'done',
  }
}

export function createAssistantPlaceholder(): ChatMessage {
  return emptyMessage(createClientKey('a'), 'assistant')
}

function emptyMessage(clientKey: string, role: ChatMessage['role']): ChatMessage {
  return {
    clientKey,
    id: null,
    role,
    content: '',
    createdAt: new Date().toISOString(),
    status: 'streaming',
    citations: [],
    queryRoute: null,
    agentSteps: null,
    verifyResult: null,
    traceId: null,
    traceUrl: null,
    cacheHit: false,
    refused: false,
    errorMessage: null,
  }
}

/** 引用排序用的主分数：优先精排分，其次 RRF，最后向量分。 */
export function citationScore(citation: ChatCitation): number | null {
  const meta = citation.meta
  if (!meta) return null
  return meta.rerank_score ?? meta.rrf_score ?? meta.vector_score ?? null
}

function maxOf(values: (number | null | undefined)[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number')
  return numbers.length ? Math.max(...numbers) : null
}

export interface RetrievalSignals {
  topRerank: number | null
  topVector: number | null
  bars: { key: string; ordinal: number; label: string; value: number }[]
  sources: { name: string; count: number }[]
  agentRounds: number | null
}

/** 根据一条 assistant 消息计算左侧 rail 的检索信号。 */
export function retrievalSignals(message: ChatMessage | null): RetrievalSignals | null {
  if (!message) return null
  const citations = message.citations
  const bars = citations
    .map((citation) => ({
      key: citation.key,
      ordinal: citation.ordinal,
      label: citation.documentName,
      value: citationScore(citation),
    }))
    .filter((bar): bar is RetrievalSignals['bars'][number] => typeof bar.value === 'number')

  const counter = new Map<string, number>()
  for (const citation of citations) {
    counter.set(citation.documentName, (counter.get(citation.documentName) ?? 0) + 1)
  }
  const sources = [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

  const rounds = message.agentSteps?.length ? Math.max(...message.agentSteps.map((step) => step.round)) : null

  return {
    topRerank: maxOf(citations.map((citation) => citation.meta?.rerank_score)),
    topVector: maxOf(citations.map((citation) => citation.meta?.vector_score)),
    bars,
    sources,
    agentRounds: rounds,
  }
}

// ---------- 检索过滤 ----------

export interface FilterDraft {
  mimeTypes: string[]
  /** yyyy-mm-dd，空串表示不限。 */
  createdFrom: string
  createdTo: string
  documents: { id: string; name: string }[]
}

export const EMPTY_FILTERS: FilterDraft = {
  mimeTypes: [],
  createdFrom: '',
  createdTo: '',
  documents: [],
}

export function activeFilterCount(draft: FilterDraft): number {
  return (
    (draft.mimeTypes.length ? 1 : 0) +
    (draft.createdFrom || draft.createdTo ? 1 : 0) +
    (draft.documents.length ? 1 : 0)
  )
}

export function validateFilters(draft: FilterDraft): string | null {
  if (draft.createdFrom && draft.createdTo && draft.createdFrom > draft.createdTo) {
    return '开始日期不能晚于结束日期'
  }
  if (draft.mimeTypes.length > FILTER_MAX_MIME_TYPES) return `文件类型最多选择 ${FILTER_MAX_MIME_TYPES} 个`
  if (draft.documents.length > FILTER_MAX_DOCUMENTS) return `指定文档最多 ${FILTER_MAX_DOCUMENTS} 个`
  return null
}

/** 本地日期转成带时区的 ISO 时间，结束日期取当天 23:59:59.999。 */
export function buildRetrievalFilters(draft: FilterDraft): RetrievalFilters | null {
  if (!activeFilterCount(draft)) return null
  const filters: RetrievalFilters = {}
  if (draft.mimeTypes.length) filters.mime_types = draft.mimeTypes
  if (draft.createdFrom) filters.created_from = new Date(`${draft.createdFrom}T00:00:00`).toISOString()
  if (draft.createdTo) filters.created_to = new Date(`${draft.createdTo}T23:59:59.999`).toISOString()
  if (draft.documents.length) filters.document_ids = draft.documents.map((doc) => doc.id)
  return filters
}
