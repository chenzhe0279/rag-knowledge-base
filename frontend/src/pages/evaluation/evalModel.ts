import { AGENT_ACTION_LABEL, QUERY_ROUTE_LABEL } from '../../lib/labels'
import type {
  AgentAction,
  AgentStep,
  EvaluationItem,
  QueryRoute,
  QueryRouteValue,
  VerifyResult,
} from '../../types/api'

/** 评测 item 的 JSON 字段在后端是无类型 dict，这里做安全收窄。 */

type Dict = { [key: string]: unknown }

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRoute(value: unknown): value is QueryRouteValue {
  return typeof value === 'string' && value in QUERY_ROUTE_LABEL
}

function isAction(value: unknown): value is AgentAction {
  return typeof value === 'string' && value in AGENT_ACTION_LABEL
}

export interface EvalCitation {
  key: string
  ordinal: number | null
  documentId: string | null
  documentName: string
  pageNo: number | null
  sectionPath: string | null
  quote: string
  score: number | null
}

export interface EvalChunk {
  key: string
  documentId: string | null
  documentName: string
  pageNo: number | null
  sectionPath: string | null
  content: string
  vectorScore: number | null
  rerankScore: number | null
  rrfScore: number | null
}

export function parseCitations(raw: Dict[] | undefined): EvalCitation[] {
  return (raw ?? []).map((item, index) => ({
    key: `${str(item.chunk_id) ?? 'c'}-${index}`,
    ordinal: num(item.ordinal),
    documentId: str(item.document_id),
    documentName: str(item.document_name) ?? '未知文档',
    pageNo: num(item.page_no),
    sectionPath: str(item.section_path),
    quote: str(item.quote) ?? '',
    score: num(item.score),
  }))
}

export function parseChunks(raw: Dict[] | undefined): EvalChunk[] {
  return (raw ?? []).map((item, index) => ({
    key: `${str(item.chunk_id) ?? 'k'}-${index}`,
    documentId: str(item.document_id),
    documentName: str(item.document_name) ?? '未知文档',
    pageNo: num(item.page_no),
    sectionPath: str(item.section_path),
    content: str(item.content) ?? '',
    vectorScore: num(item.vector_score),
    rerankScore: num(item.rerank_score),
    rrfScore: num(item.rrf_score),
  }))
}

export function parseRoute(raw: Dict | null | undefined): QueryRoute | null {
  if (!raw || !isRoute(raw.route)) return null
  const multi = Array.isArray(raw.multi_queries)
    ? raw.multi_queries.filter((query): query is string => typeof query === 'string' && !!query)
    : null
  return {
    route: raw.route,
    query: str(raw.query) ?? '',
    rewritten_query: str(raw.rewritten_query),
    hyde_answer: str(raw.hyde_answer),
    multi_queries: multi,
  }
}

export function parseAgentSteps(raw: Dict[] | null | undefined): AgentStep[] {
  if (!raw) return []
  return raw.flatMap((step) => {
    if (!isAction(step.action) || !isRoute(step.route)) return []
    return [
      {
        round: num(step.round) ?? 0,
        action: step.action,
        reason: str(step.reason) ?? '',
        route: step.route,
        query: str(step.query) ?? '',
        retrieved_count: num(step.retrieved_count),
        top_score: num(step.top_score),
        sufficient: typeof step.sufficient === 'boolean' ? step.sufficient : null,
      },
    ]
  })
}

export function parseVerify(raw: Dict | null | undefined): VerifyResult | null {
  if (!raw || typeof raw.verified !== 'boolean') return null
  return { verified: raw.verified, reason: str(raw.reason) }
}

/** 单条 case 的四项连续指标平均，用于列表里的综合分。 */
export function itemScore(item: EvaluationItem): number | null {
  const values = [
    item.faithfulness,
    item.answer_relevancy,
    item.context_precision,
    item.context_recall,
  ].filter((value): value is number => typeof value === 'number')
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export const ITEM_METRICS: {
  key: 'faithfulness' | 'answer_relevancy' | 'context_precision' | 'context_recall'
  label: string
}[] = [
  { key: 'faithfulness', label: '忠实度' },
  { key: 'answer_relevancy', label: '相关性' },
  { key: 'context_precision', label: '精确率' },
  { key: 'context_recall', label: '召回率' },
]
