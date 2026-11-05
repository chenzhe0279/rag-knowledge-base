import type {
  AgentAction,
  BadCaseCategory,
  EvaluationRun,
  EvaluationStatus,
  QueryRouteValue,
} from '../types/api'
import type { Tone } from './documents'

export const QUERY_ROUTE_LABEL: Record<QueryRouteValue, string> = {
  original: '原问题直检',
  rewrite: '问题改写',
  hyde: 'HyDE 假设文档',
  multi_query: '多查询扩展',
  rewrite_multi_query: '改写 + 多查询',
}

export const AGENT_ACTION_LABEL: Record<AgentAction, string> = {
  initial: '初始检索',
  proceed: '证据充分，生成回答',
  rewrite_query: '改写查询再检索',
  switch_route: '切换检索路由',
  refuse: '证据不足，拒答',
}

export const BAD_CASE_LABEL: Record<BadCaseCategory, string> = {
  document_parse_failed: '文档解析失败',
  chunk_split_bad: '切分不合理',
  embedding_recall_miss: '向量召回缺失',
  keyword_recall_miss: '关键词召回缺失',
  rrf_fusion_error: 'RRF 融合错误',
  rerank_order_error: '精排顺序错误',
  context_judge_too_loose: '上下文判定过松',
  context_judge_too_strict: '上下文判定过严',
  prompt_constraint_weak: 'Prompt 约束不足',
  generation_off_context: '生成偏离上下文',
  citation_parse_failed: '引用解析失败',
  permission_filter_error: '权限过滤错误',
  other: '其他',
}

export const BAD_CASE_CATEGORIES = Object.keys(BAD_CASE_LABEL) as BadCaseCategory[]

export type MetricKey =
  | 'faithfulness'
  | 'answer_relevancy'
  | 'context_precision'
  | 'context_recall'
  | 'citation_hit_rate'
  | 'refusal_accuracy'

export const METRICS: { key: MetricKey; label: string; desc: string }[] = [
  { key: 'faithfulness', label: '忠实度', desc: '回答是否被检索上下文支撑' },
  { key: 'answer_relevancy', label: '答案相关性', desc: '回答与问题的贴合程度' },
  { key: 'context_precision', label: '上下文精确率', desc: '召回内容中有用信息的占比' },
  { key: 'context_recall', label: '上下文召回率', desc: '期望信息被召回的比例' },
  { key: 'citation_hit_rate', label: '引用命中率', desc: '引用命中期望文档的比例' },
  { key: 'refusal_accuracy', label: '拒答正确率', desc: '该拒答时拒答、该回答时回答' },
]

export const EVALUATION_STATUS_META: Record<
  EvaluationStatus,
  { label: string; tone: Tone; live: boolean }
> = {
  running: { label: '运行中', tone: 'accent', live: true },
  completed: { label: '已完成', tone: 'success', live: false },
  failed: { label: '失败', tone: 'danger', live: false },
}

/** 六项指标中非空值的平均，作为 run 的综合分。 */
export function compositeScore(run: Pick<EvaluationRun, MetricKey>): number | null {
  const values = METRICS.map((metric) => run[metric.key]).filter(
    (value): value is number => typeof value === 'number',
  )
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function scoreTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined) return 'pending'
  if (value >= 0.8) return 'success'
  if (value >= 0.6) return 'warning'
  return 'danger'
}
