export type EvaluationStatusValue = 'running' | 'completed' | 'failed'

export type BadCaseCategoryValue =
  | 'document_parse_failed'
  | 'chunk_split_bad'
  | 'embedding_recall_miss'
  | 'keyword_recall_miss'
  | 'rrf_fusion_error'
  | 'rerank_order_error'
  | 'context_judge_too_loose'
  | 'context_judge_too_strict'
  | 'prompt_constraint_weak'
  | 'generation_off_context'
  | 'citation_parse_failed'
  | 'permission_filter_error'
  | 'other'

export interface DatasetInfo {
  name: string
  size: number
}

export interface DatasetListResponse {
  items: DatasetInfo[]
}

/** Run 列表与详情共有的字段。 */
export interface EvaluationRunBase {
  id: string
  name: string
  dataset_name: string
  dataset_size: number
  status: EvaluationStatusValue
  progress_total: number
  progress_completed: number
  progress_failed: number
  faithfulness?: number | null
  answer_relevancy?: number | null
  context_precision?: number | null
  context_recall?: number | null
  citation_hit_rate?: number | null
  refusal_accuracy?: number | null
  avg_latency_ms?: number | null
  avg_first_token_latency_ms?: number | null
  created_at: string
}

export interface EvaluationRun extends EvaluationRunBase {
  error_message?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export type EvaluationRunListItem = EvaluationRunBase

export interface EvaluationRunPage {
  items: EvaluationRunListItem[]
  total: number
  page: number
  page_size: number
}

export interface EvaluationCitation {
  id?: string
  ordinal?: number
  document_id?: string | null
  chunk_id?: string | null
  document_name?: string
  page_no?: number | null
  section_path?: string | null
  score?: number | null
  quote?: string
  retrieval_meta?: Record<string, unknown> | null
}

export interface EvaluationChunkMeta {
  chunk_id?: string
  document_id?: string
  document_name?: string
  page_no?: number | null
  section_path?: string | null
  content?: string
  vector_score?: number | null
  rerank_score?: number | null
  rrf_score?: number | null
}

export interface EvaluationVerifyResult {
  verified?: boolean
  reason?: string | null
}

export interface EvaluationItem {
  id: string
  run_id: string
  case_id: string
  question: string
  expected_answer: string
  expected_document_names: string[]
  expected_keywords: string[]
  should_refuse: boolean
  tags: string[]
  actual_answer: string
  actual_refused: boolean
  citations: EvaluationCitation[]
  retrieved_chunks_meta: EvaluationChunkMeta[]
  query_route: Record<string, unknown> | null
  agent_steps: unknown[] | null
  verify_result: EvaluationVerifyResult | null
  trace_id?: string | null
  latency_ms: number
  first_token_latency_ms?: number | null
  error_message?: string | null
  faithfulness?: number | null
  answer_relevancy?: number | null
  context_precision?: number | null
  context_recall?: number | null
  citation_hit?: boolean | null
  refusal_correct: boolean
  is_bad_case: boolean
  bad_case_category?: BadCaseCategoryValue | null
  bad_case_note?: string | null
  created_at: string
}

export interface EvaluationItemPage {
  items: EvaluationItem[]
  total: number
  page: number
  page_size: number
}

export interface EvaluationItemUpdate {
  bad_case_category?: BadCaseCategoryValue | null
  bad_case_note?: string | null
  is_bad_case?: boolean | null
}
