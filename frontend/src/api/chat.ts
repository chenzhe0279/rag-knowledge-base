import { fetchEventSource } from '@microsoft/fetch-event-source'
import { authHeaders, notifyAuthExpired } from '../auth/authSession'
import type {
  AgentStep,
  ConversationDetail,
  ConversationListItem,
  ConversationRead,
  Page,
  QueryRoute,
  RetrievalFilters,
  StreamCitation,
} from '../types/api'
import { ApiError, apiUrl, NETWORK_ERROR_MESSAGE, request, toApiError } from './http'

export function createConversation(title = '新对话') {
  return request<ConversationRead>('/conversations', { method: 'POST', json: { title } })
}

export function listConversations(page: number, pageSize: number, signal?: AbortSignal) {
  return request<Page<ConversationListItem>>('/conversations', {
    query: { page, page_size: pageSize },
    signal,
  })
}

export function getConversation(conversationId: string, signal?: AbortSignal) {
  return request<ConversationDetail>(`/conversations/${conversationId}`, { signal })
}

export function deleteConversation(conversationId: string) {
  return request<void>(`/conversations/${conversationId}`, { method: 'DELETE' })
}

export interface ChatStreamHandlers {
  onMessageStart?: (data: {
    user_message_id: string
    trace_id: string | null
    trace_url: string | null
    cache_hit?: boolean
  }) => void
  onQueryRoute?: (data: QueryRoute) => void
  onAgentSteps?: (steps: AgentStep[]) => void
  onCitations?: (citations: StreamCitation[]) => void
  onToken?: (delta: string) => void
  onVerifyResult?: (data: {
    verified: boolean
    reason?: string | null
    replacement_answer?: string | null
  }) => void
  onMessageEnd?: (data: { message_id: string; refused: boolean }) => void
}

/** 终止重连用的内部错误：fetch-event-source 只有在 onerror 抛错时才会停止重试。 */
class StreamFatalError extends Error {}

/**
 * SSE 流式问答。
 *
 * 失败时 reject 为 ApiError（含 401 / 429 / 业务错误 / 后端 error 事件），
 * 用户主动 abort 时 resolve，调用方根据 signal.aborted 判断。
 */
export async function streamChat(
  conversationId: string,
  payload: { question: string; filters: RetrievalFilters | null },
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let streamError: ApiError | null = null

  try {
    await fetchEventSource(apiUrl(`/conversations/${conversationId}/chat`), {
      method: 'POST',
      headers: {
        ...authHeaders(),
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
      // 默认在页面隐藏时会断开并重新 POST，会导致问题被重复提交
      openWhenHidden: true,
      async onopen(response) {
        const contentType = response.headers.get('content-type') ?? ''
        if (response.ok && contentType.includes('text/event-stream')) return
        const error = response.ok
          ? new ApiError('服务返回了非流式响应', response.status)
          : await toApiError(response)
        if (response.status === 401) notifyAuthExpired(error.message)
        streamError = error
        throw new StreamFatalError(error.message)
      },
      onmessage(event) {
        if (!event.data) return
        let data: unknown
        try {
          data = JSON.parse(event.data)
        } catch {
          return
        }
        switch (event.event) {
          case 'message_start':
            handlers.onMessageStart?.(data as Parameters<NonNullable<ChatStreamHandlers['onMessageStart']>>[0])
            break
          case 'query_route':
            handlers.onQueryRoute?.(data as QueryRoute)
            break
          case 'agent_steps':
            handlers.onAgentSteps?.((data as { steps?: AgentStep[] }).steps ?? [])
            break
          case 'citations':
            handlers.onCitations?.((data as { citations?: StreamCitation[] }).citations ?? [])
            break
          case 'token':
            handlers.onToken?.((data as { delta?: string }).delta ?? '')
            break
          case 'verify_result':
            handlers.onVerifyResult?.(data as Parameters<NonNullable<ChatStreamHandlers['onVerifyResult']>>[0])
            break
          case 'message_end':
            handlers.onMessageEnd?.(data as { message_id: string; refused: boolean })
            break
          case 'error': {
            const body = data as { code?: string; message?: string }
            streamError = new ApiError(body.message || '生成回答失败', 200, body.code ?? null)
            throw new StreamFatalError(streamError.message)
          }
          default:
            break
        }
      },
      onerror(error) {
        // 不自动重连：直接抛出终止
        if (error instanceof StreamFatalError) throw error
        streamError = streamError ?? new ApiError(NETWORK_ERROR_MESSAGE, 0, 'network_error')
        throw new StreamFatalError(streamError.message)
      },
    })
  } catch (error) {
    if (signal.aborted) return
    if (streamError) throw streamError
    if (error instanceof ApiError) throw error
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0, 'network_error')
  }
  if (streamError && !signal.aborted) throw streamError
}
