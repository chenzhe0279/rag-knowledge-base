import type { components } from './schema'

/** 后端生成的会话类型。 */
export type ConversationRead = components['schemas']['ConversationRead']
export type ConversationDetail = components['schemas']['ConversationDetail']

/** 会话分页列表；新接口在当前 OpenAPI 生成文件里可能尚未同步。 */
export interface ConversationListItem {
  id: string
  title: string
  updated_at: string
  message_count: number
}

export interface ConversationPage {
  items: ConversationListItem[]
  total: number
  page: number
  page_size: number
}

/**
 * 后端 OpenAPI 可能滞后，或缺少组合路由；前端保留 rewrite_multi_query 兼容，
 * 这样 UI、SSE 解析与历史消息都能正常处理。
 */
type ApiQueryRoute = components['schemas']['QueryRouteRead']
export type QueryRouteValue =
  | ApiQueryRoute['route']
  | 'rewrite_multi_query'
export type QueryRoute = Omit<ApiQueryRoute, 'route'> & {
  route: QueryRouteValue
}

/** Agentic RAG 每轮允许的决策动作。 */
export type AgentActionValue =
  | 'initial'
  | 'proceed'
  | 'rewrite_query'
  | 'switch_route'
  | 'refuse'

/**
 * Agent 单轮“决策 + 观察”快照。
 * 决策字段由 plan_retrieval 写入，观察字段由 observe_context 回填。
 */
export interface AgentStep {
  round: number
  action: AgentActionValue
  reason: string
  route: QueryRouteValue
  query: string
  retrieved_count?: number | null
  top_score?: number | null
  sufficient?: boolean | null
}

/** 答案可信度校验结果；replacement_answer 只在 SSE 校验失败事件中出现。 */
export interface VerifyResult {
  verified: boolean
  reason?: string | null
  replacement_answer?: string | null
}

type ApiMessageReadBase = components['schemas']['MessageRead']
/** 历史接口已返回 agent_steps / verify_result，OpenAPI 未重新生成前先承接原始数据。 */
export type ApiMessageRead = Omit<
  ApiMessageReadBase,
  'agent_steps' | 'verify_result'
> & {
  agent_steps?: unknown
  verify_result?: unknown
}

/**
 * 后端 citation.retrieval_meta 的结构。
 * sources 记录命中路径：["vector"] / ["keyword"] / ["vector", "keyword"]。
 * 各 *_rank / *_score 只有对应检索路命中时才有值。
 */
export interface RetrievalMeta {
  sources?: string[]
  vector_rank?: number | null
  vector_score?: number | null
  keyword_rank?: number | null
  keyword_score?: number | null
  rrf_score?: number | null
  rerank_score?: number | null
}

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
  /** 混合检索调试元数据；旧历史消息可能没有这个字段。 */
  retrieval_meta?: RetrievalMeta | null
}

export type ChatRole = 'user' | 'assistant' | 'system'

/** 前端统一使用的消息结构：本地临时消息与后端历史消息共用。 */
export interface ChatMessage {
  id: string
  /** 渲染用稳定 key；流结束后 id 会变成后端 UUID，但该值保持不变。 */
  clientKey: string
  role: ChatRole
  content: string
  created_at: string
  citations: ChatCitation[]
  /** 查询路由调试快照。旧消息或 user 消息为 null。 */
  queryRoute: QueryRoute | null
  /** Agentic RAG 决策轨迹。旧消息、user 消息或关闭 Agent 循环时为 null。 */
  agentSteps: AgentStep[] | null
  /** 答案可信度校验结果。旧消息、user 消息或关闭校验时为 null。 */
  verifyResult: VerifyResult | null
}

export interface ChatStreamHandlers {
  onMessageStart?: (payload: { user_message_id: string }) => void
  /** query_route 事件：query 路由与改写策略的实时快照。 */
  onQueryRoute?: (route: QueryRoute) => void
  /** agent_steps 事件：Agentic RAG 多轮决策与观察轨迹。 */
  onAgentSteps?: (steps: AgentStep[]) => void
  /** verify_result 事件：答案可信度校验结果，失败时可能带替换答案。 */
  onVerifyResult?: (result: VerifyResult) => void
  onCitations?: (citations: ChatCitation[]) => void
  onToken?: (delta: string) => void
  onMessageEnd?: (payload: {
    message_id: string
    refused: boolean
  }) => void
  onStreamError?: (payload: { code: string; message: string }) => void
  onClose?: () => void
}
