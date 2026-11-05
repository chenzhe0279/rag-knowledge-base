/**
 * 领域类型：全部派生自 openapi-typescript 生成的 schema.d.ts，
 * 后端字段变化后执行 `npm run gen:api` 即可同步。
 */
import type { components } from './schema'

type Schemas = components['schemas']

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

// ---------- 认证 / RBAC ----------
export type UserRead = Schemas['UserRead']
export type RoleRead = Schemas['RoleRead']
export type UserStatus = UserRead['status']
export type LoginResponse = Schemas['LoginResponse']
export type MeResponse = Schemas['MeResponse']
export type UserCreate = Schemas['UserCreate']
export type UserUpdate = Schemas['UserUpdate']
export type RoleCreate = Schemas['RoleCreate']
export type RoleUpdate = Schemas['RoleUpdate']

export interface AuthSession {
  user: UserRead
  permissionTags: string[]
  isAdmin: boolean
}

// ---------- 文档 ----------
export type DocumentRead = Schemas['DocumentRead']
export type DocumentStatus = DocumentRead['status']
export type IngestionTask = Schemas['IngestionTaskRead']
export type IngestionTaskStatus = IngestionTask['status']
export type DocumentChunk = Schemas['DocumentChunkRead']
export type DocumentChunkDetail = Schemas['DocumentChunkDetail']
export type DocumentChunkStats = Schemas['DocumentChunkStats']
export type DocumentChunkPage = Schemas['DocumentChunkListResponse']

// ---------- 对话 ----------
export type ConversationRead = Schemas['ConversationRead']
export type ConversationListItem = Schemas['ConversationListItem']
export type ConversationDetail = Schemas['ConversationDetail']
export type MessageRead = Schemas['MessageRead']
export type CitationRead = Schemas['CitationRead']
export type RetrievalMeta = Schemas['RetrievalMeta']
export type QueryRoute = Schemas['QueryRouteRead']
export type QueryRouteValue = QueryRoute['route']
export type AgentStep = Schemas['AgentStep']
export type AgentAction = AgentStep['action']
export type RetrievalFilters = Schemas['RetrievalFilters']

export interface VerifyResult {
  verified: boolean
  reason?: string | null
}

/** SSE citations 事件里的引用项：没有 id，多了 section_path / score。 */
export interface StreamCitation {
  ordinal: number
  chunk_id: string | null
  document_id: string | null
  document_name: string
  page_no: number | null
  section_path?: string | null
  score?: number | null
  quote: string
  retrieval_meta?: RetrievalMeta | null
}

/** 统一后的前端引用视图模型（历史与流式两种来源）。 */
export interface ChatCitation {
  key: string
  ordinal: number
  documentId: string | null
  chunkId: string | null
  documentName: string
  pageNo: number | null
  sectionPath: string | null
  quote: string
  meta: RetrievalMeta | null
}

export type ChatMessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface ChatMessage {
  /** 稳定的本地 key，用于 React 列表；后端 id 到达后不变。 */
  clientKey: string
  id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  status: ChatMessageStatus
  citations: ChatCitation[]
  queryRoute: QueryRoute | null
  agentSteps: AgentStep[] | null
  verifyResult: VerifyResult | null
  traceId: string | null
  traceUrl: string | null
  cacheHit: boolean
  refused: boolean
  errorMessage: string | null
}

// ---------- 评测 ----------
export type EvaluationRun = Schemas['EvaluationRunRead']
export type EvaluationRunListItem = Schemas['EvaluationRunListItem']
export type EvaluationStatus = EvaluationRun['status']
export type EvaluationItem = Schemas['EvaluationItemRead']
export type EvaluationItemUpdate = Schemas['EvaluationItemUpdate']
export type DatasetInfo = Schemas['DatasetInfo']
export type BadCaseCategory = NonNullable<EvaluationItem['bad_case_category']>

// ---------- 健康检查 ----------
export type HealthStatus = Schemas['HealthStatus']
