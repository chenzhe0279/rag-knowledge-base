import { memo } from 'react'
import { Link } from '../../app/Link'
import { paths } from '../../app/router'
import {
  AgentIcon,
  AlertIcon,
  ArrowUpRightIcon,
  BoltIcon,
  CheckCircleIcon,
  FileIcon,
  LayersIcon,
  RouteIcon,
  SparkIcon,
  StopIcon,
  UserIcon,
} from '../../components/Icons'
import { MarkdownView } from '../../components/MarkdownView'
import { AGENT_ACTION_LABEL, QUERY_ROUTE_LABEL } from '../../lib/labels'
import { formatScore, formatTime } from '../../lib/format'
import type { AgentStep, ChatCitation, ChatMessage, QueryRoute, RetrievalMeta } from '../../types/api'

export const MessageItem = memo(function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <li className="msg msg--user">
        <div className="msg__bubble">
          <p className="msg__text">{message.content}</p>
        </div>
        <div className="msg__meta">
          <UserIcon size={13} />
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </div>
      </li>
    )
  }

  const streaming = message.status === 'streaming'
  const showDebug = !message.cacheHit
  const hasRoute = showDebug && Boolean(message.queryRoute)
  const hasAgent = showDebug && Boolean(message.agentSteps?.length)
  const hasMeta = message.citations.some((citation) => citation.meta)

  return (
    <li className="msg msg--assistant">
      <span className="msg__avatar" aria-hidden="true">
        <SparkIcon size={16} />
      </span>
      <div className="msg__body">
        <div className="msg__meta">
          <strong>知识库助手</strong>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {message.cacheHit ? (
            <span className="badge" data-tone="accent">
              <BoltIcon size={12} />
              语义缓存 · 极速响应
            </span>
          ) : null}
          {message.refused ? (
            <span className="badge" data-tone="warning">
              证据不足 · 已拒答
            </span>
          ) : null}
          {message.status === 'stopped' ? (
            <span className="badge">
              <StopIcon size={12} />
              已停止生成
            </span>
          ) : null}
          {message.traceUrl ? (
            <a className="msg__trace" href={message.traceUrl} target="_blank" rel="noreferrer noopener">
              Trace
              <ArrowUpRightIcon size={12} />
            </a>
          ) : message.traceId ? (
            <span className="msg__trace msg__trace--static mono" title={message.traceId}>
              Trace {message.traceId.slice(0, 8)}
            </span>
          ) : null}
        </div>

        <div className="msg__bubble">
          {message.content ? (
            <div className="msg__content">
              <MarkdownView content={message.content} />
              {streaming ? <span className="chat-cursor" aria-hidden="true" /> : null}
            </div>
          ) : streaming ? (
            <ThinkingState message={message} />
          ) : message.status === 'stopped' ? (
            <p className="muted">回答在生成前已停止。</p>
          ) : null}

          {message.errorMessage ? (
            <div className="inline-error msg__error" role="alert">
              <span className="inline-error__text">
                <AlertIcon size={15} />
                {message.errorMessage}
              </span>
            </div>
          ) : null}

          {showDebug && message.verifyResult ? <VerifyNote result={message.verifyResult} /> : null}

          {message.citations.length ? <CitationChips citations={message.citations} /> : null}
        </div>

        {hasRoute || hasAgent || hasMeta ? (
          <div className="msg__panels">
            {hasRoute && message.queryRoute ? <RoutePanel route={message.queryRoute} /> : null}
            {hasAgent && message.agentSteps ? <AgentPanel steps={message.agentSteps} /> : null}
            {hasMeta ? <MetaPanel citations={message.citations} /> : null}
          </div>
        ) : null}
      </div>
    </li>
  )
})

function ThinkingState({ message }: { message: ChatMessage }) {
  let label = '正在理解问题…'
  if (message.citations.length) label = '正在组织回答…'
  else if (message.agentSteps?.length) label = '正在评估检索证据…'
  else if (message.queryRoute) label = '正在检索知识库…'
  return (
    <div className="msg__thinking">
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </div>
  )
}

function VerifyNote({ result }: { result: NonNullable<ChatMessage['verifyResult']> }) {
  return (
    <div className={result.verified ? 'msg__verify' : 'msg__verify msg__verify--failed'}>
      {result.verified ? <CheckCircleIcon size={15} /> : <AlertIcon size={15} />}
      <p>
        <strong>{result.verified ? '答案已通过事实校验' : '校验未通过，已替换为安全回答'}</strong>
        {result.reason ? <span>{result.reason}</span> : null}
      </p>
    </div>
  )
}

function citationLabel(citation: ChatCitation): string {
  return citation.pageNo ? `${citation.documentName} · 第 ${citation.pageNo} 页` : citation.documentName
}

function CitationChips({ citations }: { citations: ChatCitation[] }) {
  return (
    <div className="msg__citations">
      <span className="msg__citations-label">引用来源</span>
      <ul className="chip-list">
        {citations.map((citation) => {
          const title = citation.quote ? `${citationLabel(citation)}\n\n${citation.quote}` : citationLabel(citation)
          return (
            <li key={citation.key}>
              {citation.documentId ? (
                <Link className="cite-chip" to={paths.document(citation.documentId)} title={title}>
                  <span className="cite-chip__no num">{citation.ordinal}</span>
                  <span className="cite-chip__name">{citationLabel(citation)}</span>
                </Link>
              ) : (
                <span
                  className="cite-chip cite-chip--disabled"
                  title={`${title}\n\n原文档已删除或不可访问`}
                  aria-disabled="true"
                >
                  <span className="cite-chip__no num">{citation.ordinal}</span>
                  <span className="cite-chip__name">{citationLabel(citation)}</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function RoutePanel({ route }: { route: QueryRoute }) {
  const multi = route.multi_queries?.filter(Boolean) ?? []
  return (
    <details className="msg-panel">
      <summary>
        <RouteIcon size={15} />
        <span>检索路由</span>
        <span className="chip chip--accent">{QUERY_ROUTE_LABEL[route.route]}</span>
      </summary>
      <ol className="route-flow">
        <li>
          <span className="route-flow__label">原问题</span>
          <p>{route.query}</p>
        </li>
        {route.rewritten_query ? (
          <li>
            <span className="route-flow__label">改写后</span>
            <p>{route.rewritten_query}</p>
          </li>
        ) : null}
        {route.hyde_answer ? (
          <li>
            <span className="route-flow__label">HyDE 假设答案</span>
            <p className="route-flow__hyde">{route.hyde_answer}</p>
          </li>
        ) : null}
        {multi.length ? (
          <li>
            <span className="route-flow__label">多查询扩展 · {multi.length}</span>
            <ul className="route-flow__queries">
              {multi.map((query, index) => (
                <li key={`${index}-${query}`}>{query}</li>
              ))}
            </ul>
          </li>
        ) : null}
      </ol>
    </details>
  )
}

function AgentPanel({ steps }: { steps: AgentStep[] }) {
  const rounds = Math.max(...steps.map((step) => step.round))
  return (
    <details className="msg-panel">
      <summary>
        <AgentIcon size={15} />
        <span>Agent 轨迹</span>
        <span className="chip">{rounds} 轮</span>
      </summary>
      <ol className="agent-steps">
        {steps.map((step, index) => (
          <li key={`${step.round}-${index}`} className="agent-step" data-action={step.action}>
            <div className="agent-step__head">
              <span className="agent-step__round num">R{step.round}</span>
              <strong>{AGENT_ACTION_LABEL[step.action]}</strong>
              <span className="chip">{QUERY_ROUTE_LABEL[step.route]}</span>
              {typeof step.sufficient === 'boolean' ? (
                <span className="badge" data-tone={step.sufficient ? 'success' : 'warning'}>
                  {step.sufficient ? '证据充分' : '证据不足'}
                </span>
              ) : null}
            </div>
            <p className="agent-step__reason">{step.reason}</p>
            <dl className="agent-step__stats">
              <div>
                <dt>查询</dt>
                <dd title={step.query}>{step.query}</dd>
              </div>
              <div>
                <dt>召回</dt>
                <dd className="num">{step.retrieved_count ?? '—'}</dd>
              </div>
              <div>
                <dt>最高分</dt>
                <dd className="num">{formatScore(step.top_score)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </details>
  )
}

function sourceLabel(meta: RetrievalMeta): string {
  const sources = meta.sources ?? []
  const vector = sources.includes('vector')
  const keyword = sources.includes('keyword')
  if (vector && keyword) return '混合命中'
  if (vector) return '向量'
  if (keyword) return '关键词'
  return '—'
}

function rankScore(rank: number | null | undefined, score: number | null | undefined): string {
  if (rank === null || rank === undefined) return '—'
  return `#${rank} · ${formatScore(score)}`
}

function MetaPanel({ citations }: { citations: ChatCitation[] }) {
  return (
    <details className="msg-panel">
      <summary>
        <LayersIcon size={15} />
        <span>检索元数据</span>
        <span className="chip">{citations.length} 条引用</span>
      </summary>
      <div className="meta-table-wrap">
        <table className="meta-table">
          <thead>
            <tr>
              <th scope="col">引用</th>
              <th scope="col">来源</th>
              <th scope="col">向量</th>
              <th scope="col">关键词</th>
              <th scope="col">RRF</th>
              <th scope="col">精排</th>
            </tr>
          </thead>
          <tbody>
            {citations.map((citation) => {
              const meta = citation.meta
              return (
                <tr key={citation.key}>
                  <th scope="row">
                    <span className="meta-table__doc">
                      <FileIcon size={13} />
                      <span className="num">[{citation.ordinal}]</span>
                      <span className="meta-table__name" title={citation.documentName}>
                        {citation.documentName}
                      </span>
                    </span>
                    {citation.sectionPath ? (
                      <span className="meta-table__section">{citation.sectionPath}</span>
                    ) : null}
                  </th>
                  <td>{meta ? sourceLabel(meta) : '—'}</td>
                  <td className="num">{meta ? rankScore(meta.vector_rank, meta.vector_score) : '—'}</td>
                  <td className="num">{meta ? rankScore(meta.keyword_rank, meta.keyword_score) : '—'}</td>
                  <td className="num">{formatScore(meta?.rrf_score, 4)}</td>
                  <td className="num">{formatScore(meta?.rerank_score)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
