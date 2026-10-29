import { fetchEventSource } from '@microsoft/fetch-event-source'
import { API_BASE_URL } from '../config'
import { extractApiErrorMessage } from './documents'
import type {
  AgentActionValue,
  AgentStep,
  ApiMessageRead,
  ChatCitation,
  ChatMessage,
  ChatStreamHandlers,
  ConversationDetail,
  ConversationPage,
  ConversationRead,
  QueryRoute,
  QueryRouteValue,
  RetrievalMeta,
  VerifyResult,
} from '../types/chat'
import { AGENT_ACTION_VALUES } from '../lib/agentTrace'
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

/** 会话列表：侧栏展示最近会话。 */
export async function listConversations(
  page = 1,
  pageSize = 20,
): Promise<ConversationPage> {
  let response: Response

  try {
    response = await fetch(
      `${API_BASE_URL}/api/conversations?page=${page}&page_size=${pageSize}`,
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
    !Array.isArray((payload as ConversationPage).items)
  ) {
    throw new ChatApiError('会话列表接口返回的数据结构不符合预期')
  }

  return payload as ConversationPage
}

/** 删除会话；204 无响应体。 */
export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  let response: Response

  try {
    response = await fetch(
      `${API_BASE_URL}/api/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      },
    )
  } catch {
    throw new ChatApiError('无法连接后端服务，请确认服务已启动')
  }

  if (response.ok) {
    return
  }

  const payload = await parseJsonResponse(response)
  throw new ChatApiError(
    extractApiErrorMessage(payload, fallbackMessage(response.status)),
    response.status,
  )
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
    rerank_score: toNumberOrNull(raw.rerank_score),
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

/**
 * 后端 agent_steps 是 JSONB / SSE 联合载荷，历史脏数据不能影响聊天主流程。
 * 逐条解析，丢弃非法 step；全部非法时返回 null。
 */
function toAgentStep(input: unknown): AgentStep | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const raw = input as Record<string, unknown>
  if (
    typeof raw.round !== 'number' ||
    !Number.isFinite(raw.round) ||
    raw.round < 1 ||
    typeof raw.action !== 'string' ||
    !AGENT_ACTION_VALUES.includes(raw.action as AgentActionValue) ||
    typeof raw.route !== 'string' ||
    !QUERY_ROUTE_VALUES.includes(raw.route as QueryRouteValue) ||
    typeof raw.query !== 'string'
  ) {
    return null
  }

  return {
    round: Math.trunc(raw.round),
    action: raw.action as AgentActionValue,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    route: raw.route as QueryRouteValue,
    query: raw.query,
    retrieved_count: toNumberOrNull(raw.retrieved_count),
    top_score: toNumberOrNull(raw.top_score),
    sufficient:
      typeof raw.sufficient === 'boolean' ? raw.sufficient : null,
  }
}

function toAgentSteps(input: unknown): AgentStep[] | null {
  if (!Array.isArray(input) || input.length === 0) {
    return null
  }

  const steps = input
    .map(toAgentStep)
    .filter((step): step is AgentStep => step !== null)

  return steps.length > 0 ? steps : null
}

/** 答案校验结果：历史接口与 SSE 共用；replacement_answer 仅 SSE 失败事件携带。 */
function toVerifyResult(input: unknown): VerifyResult | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const raw = input as Record<string, unknown>
  if (typeof raw.verified !== 'boolean') {
    return null
  }

  return {
    verified: raw.verified,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    replacement_answer:
      typeof raw.replacement_answer === 'string'
        ? raw.replacement_answer
        : null,
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
    agentSteps: toAgentSteps(message.agent_steps),
    verifyResult: toVerifyResult(message.verify_result),
    traceId:
      typeof message.trace_id === 'string' && message.trace_id
        ? message.trace_id
        : null,
    traceUrl:
      typeof message.trace_url === 'string' && message.trace_url
        ? message.trace_url
        : null,
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
 * message_start -> query_route -> agent_steps -> citations -> token...
 * -> verify_result -> message_end
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
                trace_id:
                  typeof payload.trace_id === 'string'
                    ? payload.trace_id
                    : null,
                trace_url:
                  typeof payload.trace_url === 'string'
                    ? payload.trace_url
                    : null,
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
          case 'agent_steps': {
            const steps = toAgentSteps(payload.steps)
            if (steps) {
              handlers.onAgentSteps?.(steps)
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
          case 'verify_result': {
            const result = toVerifyResult(payload)
            if (result) {
              handlers.onVerifyResult?.(result)
            }
            break
          }
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
