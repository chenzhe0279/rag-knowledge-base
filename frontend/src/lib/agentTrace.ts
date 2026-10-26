import type { AgentActionValue, AgentStep } from '../types/chat'

export const AGENT_ACTION_VALUES: AgentActionValue[] = [
  'initial',
  'proceed',
  'rewrite_query',
  'switch_route',
  'refuse',
]

export interface AgentActionMeta {
  label: string
  caption: string
  description: string
}

export const AGENT_ACTION_META: Record<AgentActionValue, AgentActionMeta> = {
  initial: {
    label: '首轮启动',
    caption: 'INITIAL',
    description: '沿用 route_query 给出的首个查询与路由，进入首轮检索。',
  },
  proceed: {
    label: '继续回答',
    caption: 'PROCEED',
    description: '判断当前上下文已经足够，结束循环并进入答案生成。',
  },
  rewrite_query: {
    label: '改写查询',
    caption: 'REWRITE',
    description: '当前查询表达不够准确，换一种说法后重新检索。',
  },
  switch_route: {
    label: '切换路由',
    caption: 'SWITCH',
    description: '切换到更适合当前问题的检索策略后重新检索。',
  },
  refuse: {
    label: '主动拒答',
    caption: 'REFUSE',
    description: '多轮检索仍未命中可靠内容，提前终止并返回拒答兜底。',
  },
}

export type AgentTraceOutcome =
  | 'sufficient'
  | 'refused'
  | 'insufficient'
  | 'pending'

export interface AgentTraceSummary {
  rounds: number
  adjustments: number
  outcome: AgentTraceOutcome
  outcomeLabel: string
  finalRetrieved: number | null
  finalTopScore: number | null
}

/**
 * 将 Agent 的多轮步骤压成摘要，供折叠态与侧栏快速阅读。
 * 旧后端可能只返回一轮 initial，这里同样兼容。
 */
export function summarizeAgentSteps(steps: AgentStep[]): AgentTraceSummary {
  const last = steps[steps.length - 1]
  const adjustments = steps.filter(
    (step) =>
      step.action === 'rewrite_query' || step.action === 'switch_route',
  ).length

  let outcome: AgentTraceOutcome = 'pending'
  let outcomeLabel = '等待观察'

  if (last?.action === 'refuse') {
    outcome = 'refused'
    outcomeLabel = '主动拒答'
  } else if (last?.sufficient === true) {
    outcome = 'sufficient'
    outcomeLabel = '信息充足'
  } else if (last?.sufficient === false) {
    outcome = 'insufficient'
    outcomeLabel = '信息不足'
  }

  return {
    rounds: steps.length,
    adjustments,
    outcome,
    outcomeLabel,
    finalRetrieved:
      typeof last?.retrieved_count === 'number'
        ? last.retrieved_count
        : null,
    finalTopScore:
      typeof last?.top_score === 'number' ? last.top_score : null,
  }
}

export function formatAgentTopScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(3)
    : '—'
}

/** 单轮观察结果的用户可读文案。 */
export function getAgentObservationLabel(step: AgentStep): string {
  if (step.action === 'refuse') {
    return '未执行检索'
  }
  if (step.sufficient === true) {
    return '信息充足'
  }
  if (step.sufficient === false) {
    return '信息不足'
  }
  return '未观察'
}
