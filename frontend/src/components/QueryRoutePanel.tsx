import { ChevronRightIcon, RouteIcon } from './Icons'
import {
  QUERY_ROUTE_META,
  QUERY_ROUTE_STEPS,
  getRouteQuery,
} from '../lib/queryRoute'
import type { QueryRoute } from '../types/chat'

interface QueryRoutePanelProps {
  route: QueryRoute
  originalQuestion?: string
  live?: boolean
}

/**
 * assistant 消息的查询路由快照。
 * 摘要行常驻，详细信息通过原生 details 展开，既适合实时 SSE，也适合历史回放。
 */
export function QueryRoutePanel({
  route,
  originalQuestion = '',
  live = false,
}: QueryRoutePanelProps) {
  const meta = QUERY_ROUTE_META[route.route]
  const finalQuery = getRouteQuery(route)
  const multiQueries = (route.multi_queries ?? []).filter(Boolean)
  const isCombinedRoute = route.route === 'rewrite_multi_query'
  const summaryPreview = isCombinedRoute
    ? `${multiQueries.length} 路子查询 · ${finalQuery}`
    : finalQuery
  const mainQueryLabel =
    route.route === 'rewrite'
      ? '改写后的检索 Query'
      : route.route === 'hyde'
        ? 'HyDE 假设答案'
        : route.route === 'multi_query'
          ? '兜底检索 Query'
          : route.route === 'rewrite_multi_query'
            ? '改写后的基准 Query'
            : '最终检索 Query'
  const hasSecondaryRewrite =
    Boolean(route.rewritten_query) &&
    route.route !== 'rewrite' &&
    route.rewritten_query !== finalQuery
  const hasSecondaryHyde =
    Boolean(route.hyde_answer) &&
    route.route !== 'hyde' &&
    route.hyde_answer !== finalQuery

  return (
    <details
      className={`chat-route-debug chat-route-debug--${meta.tone} ${
        live ? 'is-live' : ''
      }`}
      data-route={route.route}
    >
      <summary className="chat-route-debug__summary">
        <span className="chat-route-debug__icon" aria-hidden="true">
          <RouteIcon />
        </span>
        <span className="chat-route-debug__heading">
          <span className="chat-route-debug__eyebrow">
            <i aria-hidden="true" />
            QUERY ROUTING · {meta.caption}
            {live ? <em>实时</em> : null}
          </span>
          <strong>{meta.label}</strong>
        </span>
        <span className="chat-route-debug__preview" title={summaryPreview}>
          {summaryPreview}
        </span>
        <span className="chat-route-debug__control">
          调试快照
          <ChevronRightIcon className="chat-route-debug__chevron" />
        </span>
      </summary>

      <div className="chat-route-debug__body">
        <div className="chat-route-debug__intro">
          <p>{meta.description}</p>
          <span className="chat-route-debug__state">
            {live ? '正在执行' : '已随消息持久化'}
          </span>
        </div>

        <div
          className="chat-route-debug__steps"
          aria-label="后端可选的五种查询路由策略"
        >
          {QUERY_ROUTE_STEPS.map((step) => (
            <span
              className={`chat-route-debug__step ${
                step.key === route.route ? 'is-active' : ''
              }`}
              key={step.key}
            >
              <i aria-hidden="true" />
              {step.label}
              {step.key === route.route ? <em>当前</em> : null}
            </span>
          ))}
        </div>

        {isCombinedRoute ? (
          <div
            className="chat-route-debug__pipeline"
            aria-label="改写与多路查询的组合执行链"
          >
            <span>原问题</span>
            <i aria-hidden="true">→</i>
            <span className="is-accent">查询改写</span>
            <i aria-hidden="true">→</i>
            <span className="is-accent">
              {multiQueries.length > 0
                ? `${multiQueries.length} 路子查询`
                : '多路子查询'}
            </span>
            <i aria-hidden="true">→</i>
            <span>合并召回</span>
          </div>
        ) : null}

        <div className="chat-route-debug__fields">
          {originalQuestion ? (
            <div className="chat-route-debug__field">
              <span>原始问题</span>
              <p>{originalQuestion}</p>
            </div>
          ) : null}

          <div className="chat-route-debug__field chat-route-debug__field--query">
            <span>{mainQueryLabel}</span>
            <p>{finalQuery}</p>
          </div>

          {hasSecondaryRewrite ? (
            <div className="chat-route-debug__field">
              <span>改写字段 rewritten_query</span>
              <p>{route.rewritten_query}</p>
            </div>
          ) : null}

          {hasSecondaryHyde ? (
            <div className="chat-route-debug__field">
              <span>假设答案 hyde_answer</span>
              <p>{route.hyde_answer}</p>
            </div>
          ) : null}

          {multiQueries.length > 0 ? (
            <div className="chat-route-debug__field">
              <span>
                multi_queries · {multiQueries.length} 个子查询
              </span>
              <ol className="chat-route-debug__queries">
                {multiQueries.map((query, index) => (
                  <li key={`${query}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {query}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        <div className="chat-route-debug__footer">
          <span>
            <i aria-hidden="true" />
            route_query → vector_search
          </span>
          <code>{route.route}</code>
        </div>
      </div>
    </details>
  )
}
