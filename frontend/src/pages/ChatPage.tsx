import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChatApiError,
  createConversation,
  getConversation,
  streamChat,
  toChatMessage,
} from '../api/chat'
import {
  ChatIcon,
  PlusIcon,
  RouteIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
} from '../components/Icons'
import { QueryRoutePanel } from '../components/QueryRoutePanel'
import { QUERY_ROUTE_META } from '../lib/queryRoute'
import { formatTime } from '../lib/format'
import type {
  ChatCitation,
  ChatMessage,
  ConversationRead,
} from '../types/chat'
import './ChatPage.css'

const CONVERSATION_STORAGE_KEY = 'rag-kb-active-conversation'

const SUGGESTIONS = [
  '员工差旅报销标准是什么？',
  '信息安全规范对密码有什么要求？',
  '总结产品技术规格 A100 的核心参数。',
]

interface ChatPageProps {
  onOpenDocument: (documentId: string) => void
}

function localId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function timestamp(): string {
  return new Date().toISOString()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function findOriginalQuestion(
  messages: ChatMessage[],
  assistantIndex: number,
): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].content
    }
  }
  return ''
}

export function ChatPage({ onOpenDocument }: ChatPageProps) {
  const [conversation, setConversation] = useState<ConversationRead | null>(
    null,
  )
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(() =>
    Boolean(window.localStorage.getItem(CONVERSATION_STORAGE_KEY)),
  )
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const savedId = window.localStorage.getItem(CONVERSATION_STORAGE_KEY)
    if (!savedId) {
      return
    }

    let active = true

    getConversation(savedId)
      .then((detail) => {
        if (!active) {
          return
        }
        setConversation(detail.conversation)
        setMessages(detail.messages.map(toChatMessage))
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return
        }
        if (
          loadError instanceof ChatApiError &&
          loadError.status === 404
        ) {
          window.localStorage.removeItem(CONVERSATION_STORAGE_KEY)
          return
        }
        setError(errorMessage(loadError, '会话加载失败'))
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const element = streamRef.current
    if (!element) {
      return
    }
    element.scrollTo({
      top: element.scrollHeight,
      behavior: streaming ? 'auto' : 'smooth',
    })
  }, [messages, streaming])

  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')
  const latestCitations = latestAssistant?.citations ?? []
  const latestQueryRoute = latestAssistant?.queryRoute ?? null
  const latestRouteMeta = latestQueryRoute
    ? QUERY_ROUTE_META[latestQueryRoute.route]
    : null
  const scores = latestCitations
    .map((citation) => citation.score)
    .filter((score): score is number => typeof score === 'number')
  const topScore = scores.length > 0 ? Math.max(...scores) : null
  const hasScores = topScore !== null
  const signalValue = hasScores
    ? Math.round(topScore * 100)
    : latestCitations.length
  const signalSuffix = hasScores
    ? '%'
    : latestCitations.length > 0
      ? '条'
      : ''
  const signalCaption = hasScores
    ? '最高引用匹配度'
    : latestCitations.length > 0
      ? '历史引用数量'
      : '最高引用匹配度'
  const canSend = input.trim().length > 0 && !streaming

  const startNewConversation = () => {
    abortRef.current?.abort()
    abortRef.current = null
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY)
    setConversation(null)
    setMessages([])
    setInput('')
    setError(null)
    setStreaming(false)
    inputRef.current?.focus()
  }

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim()
    if (!question || streaming) {
      return
    }

    setError(null)
    let activeConversation = conversation

    if (!activeConversation) {
      try {
        activeConversation = await createConversation(
          question.length > 48 ? question.slice(0, 48) : question,
        )
        setConversation(activeConversation)
        window.localStorage.setItem(
          CONVERSATION_STORAGE_KEY,
          activeConversation.id,
        )
      } catch (createError) {
        setError(errorMessage(createError, '创建会话失败'))
        return
      }
    }

    const userId = localId('local-user')
    const assistantId = localId('local-assistant')
    const createdAt = timestamp()

    setMessages((current) => [
      ...current,
      {
        id: userId,
        clientKey: userId,
        role: 'user',
        content: question,
        created_at: createdAt,
        citations: [],
        queryRoute: null,
      },
      {
        id: assistantId,
        clientKey: assistantId,
        role: 'assistant',
        content: '',
        created_at: createdAt,
        citations: [],
        queryRoute: null,
      },
    ])
    setInput('')
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller
    let ended = false

    const fillAssistantError = (message: string) => {
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId && !item.content
            ? { ...item, content: message }
            : item,
        ),
      )
    }

    try {
      await streamChat(
        activeConversation.id,
        question,
        {
          onMessageStart: ({ user_message_id }) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === userId
                  ? { ...message, id: user_message_id }
                  : message,
              ),
            )
          },
          onQueryRoute: (queryRoute) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, queryRoute }
                  : message,
              ),
            )
          },
          onCitations: (citations) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, citations }
                  : message,
              ),
            )
          },
          onToken: (delta) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            )
          },
          onMessageEnd: ({ message_id }) => {
            ended = true
            setStreaming(false)
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, id: message_id || assistantId }
                  : message,
              ),
            )
          },
          onStreamError: ({ message }) => {
            ended = true
            setStreaming(false)
            setError(message)
            fillAssistantError('回答生成失败，请稍后重试。')
          },
          onClose: () => {
            if (!ended && !controller.signal.aborted) {
              ended = true
              setStreaming(false)
              setError('回答流已结束，但没有收到完成事件')
              fillAssistantError('回答流意外结束，请稍后重试。')
            }
          },
        },
        controller.signal,
      )
    } catch (streamError) {
      if (!controller.signal.aborted) {
        setError(errorMessage(streamError, '问答失败，请稍后重试'))
        fillAssistantError('问答失败，请稍后重试。')
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setStreaming(false)
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void sendQuestion(input)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      if (!streaming && input.trim()) {
        void sendQuestion(input)
      }
    }
  }

  const openCitation = (citation: ChatCitation) => {
    if (citation.document_id) {
      onOpenDocument(citation.document_id)
    }
  }

  return (
    <main className="chat-page">
      <section className="chat-hero" aria-labelledby="chat-page-title">
        <div>
          <p className="eyebrow">
            <span className="eyebrow__mark" aria-hidden="true" />
            RETRIEVAL AUGMENTED CHAT
          </p>
          <h1 id="chat-page-title">
            向知识库
            <br />
            <span>提问</span>
          </h1>
          <p className="hero__lead">
            基于已入库文档进行检索与生成。查询路由会自动选择原查询、改写、HyDE
            或多路检索策略，回答以 SSE 流式返回，并保留完整调试快照。
          </p>
        </div>
        <div className="chat-hero__aside">
          <span className="chat-live-pill">
            <span className="chat-live-pill__dot" aria-hidden="true" />
            SSE · QUERY ROUTING
          </span>
          <p>回答来自知识库检索，不脱离文档凭空生成。</p>
          <div
            className="chat-capability-chips"
            aria-label="查询优化能力"
          >
            <span>Rewrite</span>
            <span>HyDE</span>
            <span>Multi-Query</span>
            <span>Debug Snapshot</span>
          </div>
        </div>
      </section>

      <section className="chat-layout">
        <aside className="chat-rail">
          <div className="chat-rail__card chat-rail__card--session">
            <div className="chat-rail__eyebrow">
              <ChatIcon className="icon" />
              CURRENT SESSION
            </div>
            <h2>{conversation?.title ?? '新的知识对话'}</h2>
            <p className="chat-rail__caption">
              {conversation
                ? `${messages.length} 条消息 · 本地保留会话`
                : '发送第一个问题后自动创建会话'}
            </p>
            <div className="chat-rail__meta">
              <span>
                <i className="chat-dot" aria-hidden="true" />
                知识库已连接
              </span>
              <span>
                {latestCitations.length > 0
                  ? `${latestCitations.length} 个引用`
                  : '等待检索'}
              </span>
              <span
                className="chat-route-meta"
                title={
                  latestRouteMeta
                    ? latestRouteMeta.description
                    : '发送问题后，后端会返回查询路由快照'
                }
              >
                <RouteIcon className="icon" />
                {latestRouteMeta ? latestRouteMeta.label : '等待查询路由'}
              </span>
            </div>
            <button
              type="button"
              className="chat-rail__new"
              onClick={startNewConversation}
            >
              <PlusIcon className="icon" />
              新对话
            </button>
          </div>

          <div className="chat-rail__card chat-rail__card--signal">
            <div className="chat-rail__eyebrow">RETRIEVAL SIGNAL</div>
            <div className="chat-signal__score">
              <strong>{latestCitations.length > 0 ? signalValue : '—'}</strong>
              <span>{signalSuffix}</span>
            </div>
            <p className="chat-rail__caption">{signalCaption}</p>

            <div
              className={
                latestCitations.length
                  ? 'chat-bars'
                  : 'chat-bars chat-bars--empty'
              }
              aria-label="引用匹配度图表"
            >
              {(latestCitations.length
                ? latestCitations.slice(0, 5).map((citation, index) => ({
                    key: citation.ordinal,
                    height:
                      typeof citation.score === 'number'
                        ? Math.max(
                            18,
                            Math.round(citation.score * 100),
                          )
                        : Math.max(22, 64 - index * 10),
                  }))
                : [28, 44, 34, 52, 38].map((height, index) => ({
                    key: `empty-${index}`,
                    height,
                  }))
              ).map((bar) => (
                <span className="chat-bar" key={bar.key}>
                  <i style={{ height: `${bar.height}%` }} />
                </span>
              ))}
            </div>

            <div className="chat-signal__list">
              {latestCitations.length > 0 ? (
                latestCitations.slice(0, 4).map((citation) => (
                  <button
                    type="button"
                    className="chat-source-row"
                    key={`${citation.ordinal}-${citation.document_name}`}
                    onClick={() => openCitation(citation)}
                    disabled={!citation.document_id}
                    title={citation.quote}
                  >
                    <span className="chat-source-row__index">
                      [{citation.ordinal}]
                    </span>
                    <span className="chat-source-row__name">
                      {citation.document_name}
                    </span>
                    <span className="chat-source-row__score">
                      {typeof citation.score === 'number'
                        ? `${Math.round(citation.score * 100)}%`
                        : '—'}
                    </span>
                  </button>
                ))
              ) : (
                <p className="chat-signal__empty">
                  生成回答后，命中片段会按相关度显示在这里。
                </p>
              )}
            </div>
          </div>

          <p className="chat-rail__footnote">
            `message_start → query_route → citations → token → message_end`
            <br />
            由 FastAPI SSE 推送
          </p>
        </aside>

        <section className="chat-panel" aria-labelledby="chat-panel-title">
          <header className="chat-panel__header">
            <div>
              <span className="chat-panel__eyebrow">KNOWLEDGE ASSISTANT</span>
              <h2 id="chat-panel-title">知识库问答</h2>
            </div>
            <span className="chat-panel__badge">
              <span aria-hidden="true" />
              {streaming ? '生成中' : '已连接'}
            </span>
          </header>

          <div className="chat-stream" ref={streamRef}>
            {loading ? (
              <ChatSkeleton />
            ) : messages.length === 0 ? (
              <div className="chat-welcome">
                <span className="chat-welcome__orb">
                  <SparkIcon />
                </span>
                <p className="chat-welcome__eyebrow">START A CONVERSATION</p>
                <h2>从一份文档开始</h2>
                <p>
                  问一个具体问题，系统会自动选择查询路由并检索相关片段，再基于片段生成回答。每个引用都可以打开原文档，路由调试快照会随消息保留。
                </p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      className="chat-suggestion"
                      key={suggestion}
                      onClick={() => void sendQuestion(suggestion)}
                      disabled={streaming}
                    >
                      <SparkIcon className="icon" />
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="chat-messages">
                {messages.map((message, index) => {
                  const isAssistant = message.role === 'assistant'
                  const isLast = index === messages.length - 1
                  return (
                    <article
                      className={`chat-message chat-message--${message.role}`}
                      key={message.clientKey}
                    >
                      <div className="chat-message__meta">
                        <span>{isAssistant ? '知识库助手' : '你'}</span>
                        <time>
                          {formatTime(new Date(message.created_at))}
                        </time>
                      </div>
                      <div className="chat-message__bubble">
                        {isAssistant ? (
                          message.content ? (
                            <div className="chat-markdown">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <span className="chat-thinking">
                              <i />
                              <i />
                              <i />
                              {message.queryRoute
                                ? `${
                                    QUERY_ROUTE_META[message.queryRoute.route]
                                      .label
                                  } · 正在检索与组织回答`
                                : '正在检索与组织回答'}
                            </span>
                          )
                        ) : (
                          <p>{message.content}</p>
                        )}
                        {streaming && isAssistant && isLast ? (
                          <span className="chat-caret" aria-hidden="true" />
                        ) : null}
                      </div>

                      {isAssistant && message.queryRoute ? (
                        <QueryRoutePanel
                          route={message.queryRoute}
                          originalQuestion={findOriginalQuestion(
                            messages,
                            index,
                          )}
                          live={streaming && isLast}
                        />
                      ) : null}

                      {isAssistant && message.citations.length > 0 ? (
                        <div className="chat-message__sources">
                          {message.citations.map((citation) => (
                            <button
                              type="button"
                              className="chat-source-chip"
                              key={`${citation.ordinal}-${citation.document_name}`}
                              onClick={() => openCitation(citation)}
                              disabled={!citation.document_id}
                              title={citation.quote}
                            >
                              <span>[{citation.ordinal}]</span>
                              {citation.document_name}
                              {citation.page_no ? ` · p.${citation.page_no}` : ''}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          {error ? (
            <div className="chat-error" role="alert">
              <span>!</span>
              <p>{error}</p>
              <button type="button" onClick={() => setError(null)}>
                关闭
              </button>
            </div>
          ) : null}

          <form className="chat-composer" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="问一个关于知识库文档的问题…"
              rows={2}
              maxLength={2000}
              disabled={streaming}
              aria-label="输入问题"
            />
            <div className="chat-composer__bar">
              <span>
                {input.length} / 2000 · Enter 发送，Shift + Enter 换行
              </span>
              {streaming ? (
                <button
                  type="button"
                  className="chat-send chat-send--stop"
                  onClick={stopStreaming}
                >
                  <StopIcon className="icon" />
                  停止生成
                </button>
              ) : (
                <button
                  type="submit"
                  className="chat-send"
                  disabled={!canSend}
                >
                  <SendIcon className="icon" />
                  发送
                </button>
              )}
            </div>
          </form>
        </section>
      </section>
    </main>
  )
}

function ChatSkeleton() {
  return (
    <div className="chat-skeleton" aria-label="会话加载中">
      <span className="skeleton-block skeleton-block--title" />
      <span className="skeleton-block skeleton-block--chunk" />
      <span className="skeleton-block skeleton-block--chunk" />
      <span className="skeleton-block skeleton-block--chunk" />
    </div>
  )
}
