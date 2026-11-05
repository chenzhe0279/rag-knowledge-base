import { useId, useState } from 'react'
import { Link } from '../../app/Link'
import { paths } from '../../app/router'
import {
  ChevronDownIcon,
  HistoryIcon,
  PlusIcon,
  PulseIcon,
  RefreshIcon,
  TrashIcon,
} from '../../components/Icons'
import { ErrorState, Skeleton } from '../../components/States'
import { formatRelative, formatScore } from '../../lib/format'
import { QUERY_ROUTE_LABEL } from '../../lib/labels'
import type { ChatMessage, ConversationListItem, Page } from '../../types/api'
import { retrievalSignals } from './chatModel'

interface ChatRailProps {
  conversationId: string | null
  title: string
  messageCount: number
  lastAnswer: ChatMessage | null
  conversations: Page<ConversationListItem> | null
  conversationsLoading: boolean
  conversationsError: string | null
  canLoadMore: boolean
  streaming: boolean
  onNewConversation: () => void
  onReloadConversations: () => void
  onLoadMore: () => void
  onDelete: (item: ConversationListItem) => void
}

export function ChatRail({
  conversationId,
  title,
  messageCount,
  lastAnswer,
  conversations,
  conversationsLoading,
  conversationsError,
  canLoadMore,
  streaming,
  onNewConversation,
  onReloadConversations,
  onLoadMore,
  onDelete,
}: ChatRailProps) {
  const [historyOpen, setHistoryOpen] = useState(true)
  const historyId = useId()
  const signals = retrievalSignals(lastAnswer)
  const route = lastAnswer && !lastAnswer.cacheHit ? lastAnswer.queryRoute : null

  return (
    <aside className="chat-rail" aria-label="会话与检索信号">
      <section className="glass chat-rail__card chat-session">
        <span className="eyebrow">Current session</span>
        <h2 className="chat-session__title" title={title}>
          {title}
        </h2>
        <dl className="chat-session__stats">
          <div>
            <dt>消息</dt>
            <dd className="num">{messageCount}</dd>
          </div>
          <div>
            <dt>Agent 轮次</dt>
            <dd className="num">{lastAnswer?.cacheHit ? '缓存' : (signals?.agentRounds ?? '—')}</dd>
          </div>
          <div>
            <dt>检索路由</dt>
            <dd>{route ? QUERY_ROUTE_LABEL[route.route] : '—'}</dd>
          </div>
          <div>
            <dt>最高精排分</dt>
            <dd className="num">{formatScore(signals?.topRerank)}</dd>
          </div>
        </dl>
        <button type="button" className="btn btn--dark btn--block" onClick={onNewConversation} disabled={streaming}>
          <PlusIcon size={16} />
          新对话
        </button>
      </section>

      <section className="glass chat-rail__card chat-history">
        <div className="chat-rail__head">
          <button
            type="button"
            className="chat-rail__toggle"
            aria-expanded={historyOpen}
            aria-controls={historyId}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <HistoryIcon size={16} />
            <span>会话历史</span>
            <span className="chip num">{conversations?.total ?? 0}</span>
            <ChevronDownIcon size={15} className="chat-rail__chevron" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onReloadConversations}
            disabled={conversationsLoading}
            aria-label="刷新会话列表"
            title="刷新会话列表"
          >
            <RefreshIcon size={15} className={conversationsLoading ? 'spin' : undefined} />
          </button>
        </div>

        <div id={historyId} hidden={!historyOpen}>
          {conversationsError && !conversations ? (
            <ErrorState message={conversationsError} onRetry={onReloadConversations} />
          ) : !conversations ? (
            <div className="chat-history__list">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} height={52} radius={14} />
              ))}
            </div>
          ) : conversations.items.length ? (
            <>
              <ul className="chat-history__list">
                {conversations.items.map((item) => {
                  const active = item.id === conversationId
                  return (
                    <li key={item.id} className="chat-history__item" data-active={active || undefined}>
                      <Link
                        to={paths.chat(item.id)}
                        className="chat-history__link"
                        aria-current={active ? 'page' : undefined}
                        title={item.title}
                      >
                        <span className="chat-history__title">{item.title}</span>
                        <span className="chat-history__meta">
                          <span className="num">{item.message_count}</span> 条消息 · {formatRelative(item.updated_at)}
                        </span>
                      </Link>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger chat-history__delete"
                        onClick={() => onDelete(item)}
                        disabled={streaming && active}
                        aria-label={`删除会话 ${item.title}`}
                        title="删除会话"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  )
                })}
              </ul>
              {canLoadMore ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--block chat-history__more"
                  onClick={onLoadMore}
                  disabled={conversationsLoading}
                >
                  加载更多
                </button>
              ) : null}
            </>
          ) : (
            <p className="chat-rail__empty">还没有会话，提一个问题就会自动创建。</p>
          )}
        </div>
      </section>

      <section className="glass chat-rail__card chat-signals">
        <div className="chat-rail__head">
          <h2 className="chat-rail__heading">
            <PulseIcon size={16} />
            混合检索信号
          </h2>
        </div>
        {signals && signals.bars.length ? (
          <>
            <dl className="chat-signals__top">
              <div>
                <dt>最高精排分</dt>
                <dd className="num">{formatScore(signals.topRerank)}</dd>
              </div>
              <div>
                <dt>最高向量分</dt>
                <dd className="num">{formatScore(signals.topVector)}</dd>
              </div>
            </dl>
            <SignalBars bars={signals.bars} />
            <ol className="chat-signals__sources">
              {signals.sources.slice(0, 5).map((source, index) => (
                <li key={source.name}>
                  <span className="chat-signals__rank num">{index + 1}</span>
                  <span className="chat-signals__name" title={source.name}>
                    {source.name}
                  </span>
                  <span className="num faint">×{source.count}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="chat-rail__empty">
            {lastAnswer?.refused ? '最近一次回答已拒答，没有可用的引用片段。' : '最近一次回答的引用分数会显示在这里。'}
          </p>
        )}
      </section>
    </aside>
  )
}

function SignalBars({ bars }: { bars: { key: string; ordinal: number; label: string; value: number }[] }) {
  const max = Math.max(...bars.map((bar) => bar.value), 0)
  return (
    <ul className="signal-bars" aria-label="引用片段得分">
      {bars.map((bar) => {
        const ratio = max > 0 ? Math.max(0.06, bar.value / max) : 0.06
        return (
          <li key={bar.key} title={`[${bar.ordinal}] ${bar.label} · ${formatScore(bar.value)}`}>
            <span className="signal-bars__bar" style={{ height: `${Math.round(ratio * 100)}%` }} />
            <span className="signal-bars__label num">{bar.ordinal}</span>
          </li>
        )
      })}
    </ul>
  )
}
