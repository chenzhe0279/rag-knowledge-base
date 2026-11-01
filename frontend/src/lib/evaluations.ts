import type {
  BadCaseCategoryValue,
  EvaluationRun,
  EvaluationRunListItem,
  EvaluationStatusValue,
} from '../types/evaluations'

export type EvaluationMetricKey =
  | 'faithfulness'
  | 'answer_relevancy'
  | 'context_precision'
  | 'context_recall'
  | 'citation_hit_rate'
  | 'refusal_accuracy'

export interface EvaluationMetricDef {
  key: EvaluationMetricKey
  label: string
  caption: string
  description: string
}

export const EVALUATION_METRICS: EvaluationMetricDef[] = [
  {
    key: 'faithfulness',
    label: '忠实度',
    caption: 'FAITHFULNESS',
    description: '回答是否完全基于检索上下文，避免幻觉。',
  },
  {
    key: 'answer_relevancy',
    label: '答案相关性',
    caption: 'ANSWER RELEVANCY',
    description: '回答是否真正针对用户问题，避免答非所问。',
  },
  {
    key: 'context_precision',
    label: '上下文精确率',
    caption: 'CONTEXT PRECISION',
    description: '召回内容中有多少比例真正有助于回答。',
  },
  {
    key: 'context_recall',
    label: '上下文召回率',
    caption: 'CONTEXT RECALL',
    description: '回答问题所需的信息有多少被成功召回。',
  },
  {
    key: 'citation_hit_rate',
    label: '引用命中率',
    caption: 'CITATION HIT',
    description: '引用文档/关键词是否命中评测集预期。',
  },
  {
    key: 'refusal_accuracy',
    label: '拒答正确率',
    caption: 'REFUSAL ACCURACY',
    description: '该拒答时拒答、不该拒答时正常回答。',
  },
]

export const EVALUATION_STATUS_META: Record<
  EvaluationStatusValue,
  { label: string; caption: string }
> = {
  running: { label: '运行中', caption: 'RUNNING' },
  completed: { label: '已完成', caption: 'COMPLETED' },
  failed: { label: '失败', caption: 'FAILED' },
}

export const BAD_CASE_CATEGORY_META: Record<
  BadCaseCategoryValue,
  string
> = {
  document_parse_failed: '文档解析失败',
  chunk_split_bad: '切分质量差',
  embedding_recall_miss: '向量召回缺失',
  keyword_recall_miss: '关键词召回缺失',
  rrf_fusion_error: 'RRF 融合异常',
  rerank_order_error: '精排顺序错误',
  context_judge_too_loose: '上下文判定过松',
  context_judge_too_strict: '上下文判定过严',
  prompt_constraint_weak: '提示词约束不足',
  generation_off_context: '生成偏离上下文',
  citation_parse_failed: '引用解析失败',
  permission_filter_error: '权限过滤错误',
  other: '其他',
}

export const BAD_CASE_CATEGORY_OPTIONS = Object.entries(
  BAD_CASE_CATEGORY_META,
).map(([value, label]) => ({
  value: value as BadCaseCategoryValue,
  label,
}))

export function formatEvaluationScore(
  value: number | null | undefined,
  digits = 3,
): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : '—'
}

export function scorePercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.min(100, Math.max(0, Math.round(value * 100)))
}

export function formatLatency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }
  return value < 1000
    ? `${Math.max(0, Math.round(value))} ms`
    : `${(value / 1000).toFixed(2)} s`
}

export function formatRunDuration(
  run: Pick<EvaluationRun, 'started_at' | 'finished_at'>,
): string {
  if (!run.started_at) {
    return '—'
  }

  const started = new Date(run.started_at).getTime()
  const finished = run.finished_at
    ? new Date(run.finished_at).getTime()
    : Date.now()
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return '—'
  }

  const seconds = Math.max(0, Math.round((finished - started) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder}s`
}

export function getRunOverallScore(
  run: EvaluationRun | EvaluationRunListItem,
): number | null {
  const values = [
    run.faithfulness,
    run.answer_relevancy,
    run.context_precision,
    run.context_recall,
  ].filter((value): value is number => typeof value === 'number')
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function formatProgress(
  completed: number,
  total: number,
): string {
  if (total <= 0) {
    return '0 / 0'
  }
  return `${completed} / ${total}`
}

export function progressPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
}
