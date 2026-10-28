import { ChatIcon, ChevronRightIcon, TrashIcon } from './Icons'
import { formatDateTime } from '../lib/format'
import type { ConversationListItem } from '../types/chat'

interface ConversationHistoryProps {
  items: ConversationListItem[]
  activeId: string | null
  total: number
  loading: boolean
  error: string | null
  disabled?: boolean
  onSelect: (conversationId: string) => void
  onDelete: (conversation: ConversationListItem) => void
  onRetry: () => void
}

/**
 * 会话历史列表：切换历史会话、删除会话。
 * 列表只在后端返回有效数据时渲染；加载/失败/空态都给出明确反馈。
 */
export function ConversationHistory({
  items,
  activeId,
  total,
  loading,
  error,
  disabled = false,
  onSelect,
  onDelete,
  onRetry,
}: ConversationHistoryProps) {
  return (
    <details
      className="chat-rail__card chat-rail__card--history"
      aria-labelledby="chat-history-title"
    >
      <summary className="chat-history__head">
        <span className="chat-history__eyebrow">
          <ChatIcon className="icon" />
          <span id="chat-history-title">CONVERSATION LOG</span>
        </span>
        <span className="chat-history__count">
          {total} 个会话
          <ChevronRightIcon className="chat-history__chevron" />
        </span>
      </summary>

      <div className="chat-history__body">
        {error ? (
          <div className="chat-history__error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onRetry} disabled={loading}>
              重试
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="chat-history__skeletons" aria-label="会话列表加载中">
            <span />
            <span />
            <span />
          </div>
        ) : items.length === 0 ? (
          <p className="chat-history__empty">
            暂无历史会话。发送第一个问题后，会话会自动出现在这里。
          </p>
        ) : (
          <ul className="chat-history__list">
            {items.map((item) => {
              const isActive = item.id === activeId

              return (
                <li
                  className={`chat-history__item ${isActive ? 'is-active' : ''}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className="chat-history__select"
                    onClick={() => onSelect(item.id)}
                    disabled={disabled}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.title}
                  >
                    <span className="chat-history__title">{item.title}</span>
                    <span className="chat-history__meta">
                      <span>{item.message_count} 条</span>
                      <span>{formatDateTime(item.updated_at)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-history__delete"
                    onClick={() => onDelete(item)}
                    disabled={disabled}
                    aria-label={`删除会话 ${item.title}`}
                    title="删除会话"
                  >
                    <TrashIcon className="icon" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {total > items.length && !loading ? (
          <p className="chat-history__hint">
            当前展示最近 {items.length} 个，共 {total} 个会话
          </p>
        ) : null}
      </div>
    </details>
  )
}
