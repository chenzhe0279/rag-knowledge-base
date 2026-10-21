import type { components } from './schema'

/** 后端生成的会话类型。 */
export type ConversationRead = components['schemas']['ConversationRead']
export type ConversationDetail = components['schemas']['ConversationDetail']
export type ApiMessageRead = components['schemas']['MessageRead']

/**
 * SSE citations 事件比历史接口多返回 section_path / score，
 * 历史接口的 citation 有 id，SSE 版本没有 id，因此这里都设为可选。
 */
export interface ChatCitation {
  id?: string
  ordinal: number
  document_id?: string | null
  chunk_id?: string | null
  document_name: string
  page_no?: number | null
  section_path?: string | null
  score?: number
  quote: string
}

export type ChatRole = 'user' | 'assistant' | 'system'

/** 前端统一使用的消息结构：本地临时消息与后端历史消息共用。 */
export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  created_at: string
  citations: ChatCitation[]
}

export interface ChatStreamHandlers {
  onMessageStart?: (payload: { user_message_id: string }) => void
  onCitations?: (citations: ChatCitation[]) => void
  onToken?: (delta: string) => void
  onMessageEnd?: (payload: {
    message_id: string
    refused: boolean
  }) => void
  onStreamError?: (payload: { code: string; message: string }) => void
  onClose?: () => void
}
