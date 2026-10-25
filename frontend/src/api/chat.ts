import { fetchEventSource } from '@microsoft/fetch-event-source'
import { API_BASE_URL } from '../config'
import { extractApiErrorMessage } from './documents'
import type {
  ApiMessageRead,
  ChatCitation,
  ChatMessage,
  ChatStreamHandlers,
  ConversationDetail,
  ConversationRead,
  QueryRoute,
  QueryRouteValue,
  RetrievalMeta,
} from '../types/chat'
import type { ApiRetrievalFilters } from '../lib/retrievalFilters'

export class ChatApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status
  }
}

function fallbackMessage(status?: number): string {
  if (status === 404) {
    return '会话不存在或已经被删除'
  }
  if (status === 422) {
    return '请求参数不合法'
  }
  if (status === 503) {
    return '问答服务暂不可用'
  }
  return status ? `请求失败（HTTP ${status}）` : '请求失败'
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export async function createConversation(
  title = '新对话',
): Promise<ConversationRead> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}/api/conversations`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: title.slice(0, 256) }),
    })
  } catch {
    throw new ChatApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload = await parseJsonResponse(response)

  if (!response.ok) {
    throw new ChatApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as ConversationRead).id !== 'string'
  ) {
    throw new ChatApiError('创建会话接口返回的数据结构不符合预期')
  }

  return payload as ConversationRead
}

export async function getConversation(
  conversationId: string,
): Promise<ConversationDetail> {
  let response: Response

  try {
    response = await fetch(
      `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}`,
      { headers: { Accept: 'application/json' } },
    )
  } catch {
    throw new ChatApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload = await parseJsonResponse(response)

  if (!response.ok) {
    throw new ChatApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !(payload as ConversationDetail).conversation ||
    !Array.isArray((payload as ConversationDetail).messages)
  ) {
    throw new ChatApiError('会话详情接口返回的数据结构不符合预期')
  }

  return payload as ConversationDetail
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 后端 retrieval_meta 是 JSONB，历史数据可能缺失或字段类型异常。
 * 这里做一次防御式解析，避免调试数据把聊天主流程打挂。
 */
function toRetrievalMeta(input: unknown): RetrievalMeta | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const raw = input as Record<string, unknown>
  return {
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((source): source is string => typeof source === 'string')
      : [],
    vector_rank: toNumberOrNull(raw.vector_rank),
    vector_score: toNumberOrNull(raw.vector_score),
    keyword_rank: toNumberOrNull(raw.keyword_rank),
    keyword_score: toNumberOrNull(raw.keyword_score),
    rrf_score: toNumberOrNull(raw.rrf_score),
  }
}

function toCitation(citation: ChatCitation): ChatCitation {
  return {
    id: citation.id,
    ordinal: citation.ordinal,
    document_id: citation.document_id ?? null,
    chunk_id: citation.chunk_id ?? null,
    document_name: citation.document_name,
    page_no: citation.page_no ?? null,
    section_path: citation.section_path ?? null,
    score: citation.score,
    quote: citation.quote,
    retrieval_meta: toRetrievalMeta(citation.retrieval_meta),
  }
}

const QUERY_ROUTE_VALUES: QueryRouteValue[] = [
  'original',
  'rewrite',
  'hyde',
  'multi_query',
  'rewrite_multi_query',
]

/**
 * SSE 与历史接口共用同一份 query_route 快照。
 * 后端已做容错，前端仍对未知字段做一次防御，避免调试数据破坏聊天主流程。
 */
function toQueryRoute(input: unknown): QueryRoute | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const raw = input as Record<string, unknown>
  if (
    typeof raw.route !== 'string' ||
    !QUERY_ROUTE_VALUES.includes(raw.route as QueryRouteValue) ||
    typeof raw.query !== 'string'
  ) {
    return null
  }

  const rewrittenQuery =
    typeof raw.rewritten_query === 'string' ? raw.rewritten_query : undefined
  const hydeAnswer =
    typeof raw.hyde_answer === 'string' ? raw.hyde_answer : undefined
  const multiQueries = Array.isArray(raw.multi_queries)
    ? raw.multi_queries.filter(
        (query): query is string => typeof query === 'string',
      )
    : undefined

  return {
    route: raw.route as QueryRouteValue,
    query: raw.query,
    rewritten_query: rewrittenQuery,
    hyde_answer: hydeAnswer,
    multi_queries: multiQueries,
  }
}

export function toChatMessage(message: ApiMessageRead): ChatMessage {
  return {
    id: message.id,
    clientKey: message.id,
    role: message.role,
    content: message.content,
    created_at: message.created_at,
    citations: (message.citations ?? []).map(toCitation),
    queryRoute: toQueryRoute(message.query_route),
  }
}

function parseSseData(data: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(data)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * 使用 @microsoft/fetch-event-source 消费后端的 SSE 流。
 *
 * 后端事件协议：
 * message_start -> query_route -> citations -> token... -> message_end
 * 任意阶段失败会发送 error 事件。
 */
export async function streamChat(
  conversationId: string,
  question: string,
  filters: ApiRetrievalFilters | null,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const body: Record<string, unknown> = { question }
  if (filters) {
    body.filters = filters
  }

  await fetchEventSource(
    `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}/chat`,
    {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
      openWhenHidden: true,

      async onopen(response) {
        const contentType = response.headers.get('content-type') ?? ''

        if (!response.ok) {
          const text = await response.text()
          let payload: unknown = null
          try {
            payload = JSON.parse(text)
          } catch {
            payload = null
          }
          throw new ChatApiError(
            extractApiErrorMessage(
              payload,
              fallbackMessage(response.status),
            ),
            response.status,
          )
        }

        if (!contentType.includes('text/event-stream')) {
          throw new ChatApiError('后端没有返回 SSE 数据流，请检查接口配置')
        }
      },

      onmessage(message) {
        if (!message.event) {
          return
        }

        const payload = parseSseData(message.data)

        switch (message.event) {
          case 'message_start':
            if (typeof payload.user_message_id === 'string') {
              handlers.onMessageStart?.({
                user_message_id: payload.user_message_id,
              })
            }
            break
          case 'query_route': {
            const queryRoute = toQueryRoute(payload)
            if (queryRoute) {
              handlers.onQueryRoute?.(queryRoute)
            }
            break
          }
          case 'citations':
            handlers.onCitations?.(
              Array.isArray(payload.citations)
                ? (payload.citations as ChatCitation[]).map(toCitation)
                : [],
            )
            break
          case 'token':
            if (typeof payload.delta === 'string') {
              handlers.onToken?.(payload.delta)
            }
            break
          case 'message_end':
            handlers.onMessageEnd?.({
              message_id:
                typeof payload.message_id === 'string'
                  ? payload.message_id
                  : '',
              refused: Boolean(payload.refused),
            })
            break
          case 'error':
            handlers.onStreamError?.({
              code:
                typeof payload.code === 'string'
                  ? payload.code
                  : 'chat_stream_failed',
              message:
                typeof payload.message === 'string'
                  ? payload.message
                  : '问答处理失败',
            })
            break
          default:
            break
        }
      },

      onclose() {
        handlers.onClose?.()
      },

      onerror(error) {
        // 抛出后 fetchEventSource 会终止连接，不会自动重试。
        throw error
      },
    },
  )
}
