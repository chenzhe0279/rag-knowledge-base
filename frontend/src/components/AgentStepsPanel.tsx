import { AgentIcon, ChevronRightIcon } from './Icons'
import {
  AGENT_ACTION_META,
  formatAgentTopScore,
  getAgentObservationLabel,
  summarizeAgentSteps,
} from '../lib/agentTrace'
import { QUERY_ROUTE_META } from '../lib/queryRoute'
import type { AgentStep } from '../types/chat'

interface AgentStepsPanelProps {
  steps: AgentStep[]
  live?: boolean
}

/**
 * Agentic RAG 的决策与观察轨迹。
 * 外层复用查询路由面板的玻璃折叠壳，内部按轮次展示 plan → retrieve → observe。
 */
export function AgentStepsPanel({
  steps,
  live = false,
}: AgentStepsPanelProps) {
  if (steps.length === 0) {
    return null
  }

  const summary = summarizeAgentSteps(steps)
  const adjustmentText =
    summary.adjustments > 0
      ? `${summary.adjustments} 次调整`
      : '无策略调整'
  const summaryText = `${summary.rounds} 轮 · ${adjustmentText} · ${summary.outcomeLabel}`

  return (
    <details
      className={`chat-route-debug chat-agent-debug ${
        live ? 'is-live' : ''
      }`}
      data-outcome={summary.outcome}
      data-rounds={summary.rounds}
    >
      <summary className="chat-route-debug__summary">
        <span className="chat-route-debug__icon" aria-hidden="true">
          <AgentIcon />
        </span>
        <span className="chat-route-debug__heading">
          <span className="chat-route-debug__eyebrow">
            <i aria-hidden="true" />
            AGENTIC RAG · DECISION TRACE
            {live ? <em>实时</em> : null}
          </span>
          <strong>Agent 检索轨迹</strong>
        </span>
        <span className="chat-route-debug__preview" title={summaryText}>
          {summaryText}
        </span>
        <span className="chat-route-debug__control">
          查看轨迹
          <ChevronRightIcon className="chat-route-debug__chevron" />
        </span>
      </summary>

      <div className="chat-route-debug__body">
        <div className="chat-route-debug__intro">
          <p>
            Agent 逐轮观察召回数量与 Top 语义相似度，决定继续、改写查询、
            切换策略或提前拒答；循环收敛后统一进入 Rerank 精排与最终裁判，
            再由答案校验决定是否输出。
          </p>
          <span className="chat-route-debug__state">
            {live ? '正在生成回答' : '已随消息持久化'}
          </span>
        </div>

        <div className="agent-trace__stats" aria-label="Agent 检索摘要">
          <div className="agent-trace__stat">
            <strong>{summary.rounds}</strong>
            <span>决策轮次</span>
          </div>
          <div className="agent-trace__stat">
            <strong>{summary.adjustments}</strong>
            <span>策略调整</span>
          </div>
          <div className="agent-trace__stat">
            <strong>{summary.finalRetrieved ?? '—'}</strong>
            <span>最终召回</span>
          </div>
          <div
            className={`agent-trace__stat agent-trace__stat--outcome is-${summary.outcome}`}
          >
            <strong>{summary.outcomeLabel}</strong>
            <span>循环观察</span>
          </div>
        </div>

        <ol className="agent-trace__timeline" aria-label="Agent 检索轮次">
          {steps.map((step, index) => {
            const action = AGENT_ACTION_META[step.action]
            const route = QUERY_ROUTE_META[step.route]
            const isLast = index === steps.length - 1
            const observation = getAgentObservationLabel(step)
            const observationTone =
              step.action === 'refuse'
                ? 'is-muted'
                : step.sufficient === true
                  ? 'is-ok'
                  : step.sufficient === false
                    ? 'is-warn'
                    : 'is-pending'

            return (
              <li
                className="agent-trace__step"
                data-action={step.action}
                data-round={step.round}
                key={`${step.round}-${step.action}-${index}`}
              >
                <span className="agent-trace__marker" aria-hidden="true">
                  {String(step.round).padStart(2, '0')}
                </span>
                <div className="agent-trace__card">
                  <div className="agent-trace__head">
                    <span
                      className="agent-trace__action"
                      title={action.description}
                    >
                      {action.label}
                    </span>
                    <span
                      className="agent-trace__route"
                      data-route={step.route}
                      title={`${route.caption} · ${route.description}`}
                    >
                      {route.label}
                    </span>
                    {isLast ? (
                      <span className="agent-trace__last">当前轮</span>
                    ) : null}
                  </div>

                  <p className="agent-trace__reason">
                    {step.reason || '未提供决策原因'}
                  </p>
                  <p className="agent-trace__query">{step.query}</p>

                  <div className="agent-trace__signals">
                    {step.action === 'refuse' ? (
                      <span className="is-muted">未执行检索</span>
                    ) : (
                      <>
                        <span>
                          召回
                          <strong>{step.retrieved_count ?? '—'}</strong>
                        </span>
                        <span>
                          Top 相似度
                          <strong>
                            {formatAgentTopScore(step.top_score)}
                          </strong>
                        </span>
                        <span className={observationTone}>{observation}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="chat-route-debug__footer">
          <span>
            <i aria-hidden="true" />
            plan → retrieve → observe → rerank → judge_context
          </span>
          <code>{summary.rounds} rounds</code>
        </div>
      </div>
    </details>
  )
}
