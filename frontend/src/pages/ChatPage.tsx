import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChatApiError,
  createConversation,
  deleteConversation as deleteConversationRequest,
  getConversation,
  listConversations,
  streamChat,
  toChatMessage,
} from '../api/chat'
import {
  AgentIcon,
  ChatIcon,
  PlusIcon,
  RouteIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
} from '../components/Icons'
import { AgentStepsPanel } from '../components/AgentStepsPanel'
import { AnswerVerifyNotice } from '../components/AnswerVerifyNotice'
import { ConversationHistory } from '../components/ConversationHistory'
import { QueryRoutePanel } from '../components/QueryRoutePanel'
import { RetrievalFilterBar } from '../components/RetrievalFilterBar'
import { RetrievalMetaPanel } from '../components/RetrievalMetaPanel'
import { summarizeAgentSteps } from '../lib/agentTrace'
import { QUERY_ROUTE_META } from '../lib/queryRoute'
import {
  formatCitationMeta,
  getPreferredRetrievalScore,
  getPreferredRetrievalScoreLabel,
  getRetrievalSourceKind,
  getRetrievalSourceLabel,
} from '../lib/retrieval'
import {
  emptyChatFilters,
  getFilterDateError,
  toApiFilters,
  type ChatFilters,
} from '../lib/retrievalFilters'
import { formatTime } from '../lib/format'
import type {
  ChatCitation,
  ChatMessage,
  ConversationListItem,
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

/** 引用按钮的悬浮提示：原文 + 混合检索排名摘要。 */
function citationTitle(citation: ChatCitation): string {
  const meta = formatCitationMeta(citation)
  return meta ? `${citation.quote}\n\n${meta}` : citation.quote
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
  const [conversationList, setConversationList] = useState<
    ConversationListItem[]
  >([])
  const [conversationTotal, setConversationTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(() =>
    Boolean(window.localStorage.getItem(CONVERSATION_STORAGE_KEY)),
  )
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ChatFilters>(() => emptyChatFilters())
  const streamRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadConversationList = async (showLoading = false) => {
    if (showLoading) {
      setHistoryLoading(true)
    }

    try {
      const page = await listConversations(1, 20)
      setConversationList(page.items)
      setConversationTotal(page.total)
      setHistoryError(null)
    } catch (listError: unknown) {
      setHistoryError(errorMessage(listError, '会话列表加载失败'))
    } finally {
      if (showLoading) {
        setHistoryLoading(false)
      }
    }
  }

  useEffect(() => {
    let active = true

    listConversations(1, 20)
      .then((page) => {
        if (!active) {
          return
        }
        setConversationList(page.items)
        setConversationTotal(page.total)
        setHistoryError(null)
      })
      .catch((listError: unknown) => {
        if (active) {
          setHistoryError(errorMessage(listError, '会话列表加载失败'))
        }
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

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
  const latestAgentSteps = latestAssistant?.agentSteps ?? null
  const latestAgentSummary = latestAgentSteps
    ? summarizeAgentSteps(latestAgentSteps)
    : null
  const latestRouteMeta = latestQueryRoute
    ? QUERY_ROUTE_META[latestQueryRoute.route]
    : null
  const preferredScores = latestCitations
    .map((citation) => getPreferredRetrievalScore(citation.retrieval_meta))
    .filter((score): score is number => typeof score === 'number')
  const topPreferredScore =
    preferredScores.length > 0 ? Math.max(...preferredScores) : null
  const topPreferredPercent =
    topPreferredScore === null ? null : Math.round(topPreferredScore * 100)
  const hasRerankScore = latestCitations.some(
    (citation) => typeof citation.retrieval_meta?.rerank_score === 'number',
  )
  const signalValue = topPreferredPercent ?? latestCitations.length
  const signalSuffix =
    topPreferredPercent !== null
      ? '%'
      : latestCitations.length > 0
        ? '条'
        : ''
  const signalCaption =
    topPreferredPercent !== null
      ? hasRerankScore
        ? '最高精排分'
        : '最高向量相似度'
      : latestCitations.length > 0
        ? '引用数量'
        : '最高精排分'
  const filterError = getFilterDateError(filters)
  const canSend = input.trim().length > 0 && !streaming && !filterError

  const startNewConversation = () => {
    abortRef.current?.abort()
    abortRef.current = null
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY)
    setConversation(null)
    setMessages([])
    setInput('')
    setError(null)
    setStreaming(false)
    setLoading(false)
    inputRef.current?.focus()
  }

  const openConversation = async (conversationId: string) => {
    if (streaming || conversationId === conversation?.id) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = null
    setLoading(true)
    setError(null)

    try {
      const detail = await getConversation(conversationId)
      setConversation(detail.conversation)
      setMessages(detail.messages.map(toChatMessage))
      window.localStorage.setItem(
        CONVERSATION_STORAGE_KEY,
        detail.conversation.id,
      )
    } catch (loadError: unknown) {
      if (loadError instanceof ChatApiError && loadError.status === 404) {
        setConversationList((current) =>
          current.filter((item) => item.id !== conversationId),
        )
        setConversationTotal((current) => Math.max(0, current - 1))
        setError('该会话已被删除，请选择其他会话')
      } else {
        setError(errorMessage(loadError, '会话加载失败'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteConversation = async (item: ConversationListItem) => {
    if (streaming) {
      return
    }

    const confirmed = window.confirm(
      `确定删除会话「${item.title}」吗？\n删除后聊天记录无法恢复。`,
    )
    if (!confirmed) {
      return
    }

    try {
      await deleteConversationRequest(item.id)
      setConversationList((current) =>
        current.filter((conversation) => conversation.id !== item.id),
      )
      setConversationTotal((current) => Math.max(0, current - 1))

      if (conversation?.id === item.id) {
        startNewConversation()
      }
    } catch (deleteError: unknown) {
      setError(errorMessage(deleteError, '删除会话失败'))
    }
  }

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim()
    if (!question || streaming) {
      return
    }

    const currentFilterError = getFilterDateError(filters)
    if (currentFilterError) {
      setError(currentFilterError)
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
        void loadConversationList(false)
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
        agentSteps: null,
        verifyResult: null,
      },
      {
        id: assistantId,
        clientKey: assistantId,
        role: 'assistant',
        content: '',
        created_at: createdAt,
        citations: [],
        queryRoute: null,
        agentSteps: null,
        verifyResult: null,
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
        toApiFilters(filters),
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
          onAgentSteps: (agentSteps) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, agentSteps }
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
          onVerifyResult: (verifyResult) => {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) {
                  return message
                }

                const replacedContent =
                  !verifyResult.verified && verifyResult.replacement_answer
                    ? verifyResult.replacement_answer
                    : message.content

                return {
                  ...message,
                  content: replacedContent,
                  verifyResult: {
                    verified: verifyResult.verified,
                    reason: verifyResult.reason ?? null,
                  },
                }
              }),
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
            void loadConversationList(false)
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
            基于已入库文档进行检索与生成。Agent 会先规划检索，观察召回数量与
            Top 语义相似度，必要时改写查询、切换策略或主动拒答；随后通过向量语义
            与关键词全文的混合检索、RRF 融合与 rerank 精排，再由答案可信度校验
            决定最终输出。完整决策轨迹、会话历史和校验结果都会保留。
          </p>
        </div>
        <div className="chat-hero__aside">
          <span className="chat-live-pill">
            <span className="chat-live-pill__dot" aria-hidden="true" />
            SSE · AGENTIC RAG
          </span>
          <p>回答来自知识库检索，不脱离文档凭空生成。</p>
          <div
            className="chat-capability-chips"
            aria-label="Agentic RAG 能力"
          >
            <span>Agent Loop</span>
            <span>Rewrite</span>
            <span>HyDE</span>
            <span>Multi-Query</span>
            <span>Hybrid + RRF</span>
            <span>Rerank</span>
            <span>Verified</span>
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
                ? `${messages.length} 条消息 · 服务端保留会话`
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
              {latestAgentSummary ? (
                <span
                  className="chat-agent-meta"
                  title={`Agent 执行 ${latestAgentSummary.rounds} 轮，${latestAgentSummary.adjustments} 次策略调整，最终判断：${latestAgentSummary.outcomeLabel}`}
                >
                  <AgentIcon className="icon" />
                  Agent · {latestAgentSummary.rounds} 轮
                </span>
              ) : null}
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

          <ConversationHistory
            items={conversationList}
            activeId={conversation?.id ?? null}
            total={conversationTotal}
            loading={historyLoading}
            error={historyError}
            disabled={streaming || loading}
            onSelect={(conversationId) => {
              void openConversation(conversationId)
            }}
            onDelete={(item) => {
              void handleDeleteConversation(item)
            }}
            onRetry={() => {
              void loadConversationList(true)
            }}
          />

          <div className="chat-rail__card chat-rail__card--signal">
            <div className="chat-rail__eyebrow">HYBRID RETRIEVAL</div>
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
                ? latestCitations.slice(0, 5).map((citation, index) => {
                    const preferredScore = getPreferredRetrievalScore(
                      citation.retrieval_meta,
                    )

                    return {
                      key: citation.ordinal,
                      height:
                        typeof preferredScore === 'number'
                          ? Math.min(
                              100,
                              Math.max(18, Math.round(preferredScore * 100)),
                            )
                          : Math.max(22, 64 - index * 10),
                    }
                  })
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
                latestCitations.slice(0, 4).map((citation) => {
                  const kind = getRetrievalSourceKind(
                    citation.retrieval_meta,
                  )
                  const preferredScore = getPreferredRetrievalScore(
                    citation.retrieval_meta,
                  )
                  const preferredLabel = getPreferredRetrievalScoreLabel(
                    citation.retrieval_meta,
                  )
                  const keywordRank = citation.retrieval_meta?.keyword_rank

                  return (
                    <button
                      type="button"
                      className="chat-source-row"
                      key={`${citation.ordinal}-${citation.document_name}`}
                      onClick={() => openCitation(citation)}
                      disabled={!citation.document_id}
                      title={citationTitle(citation)}
                    >
                      <span className="chat-source-row__index">
                        [{citation.ordinal}]
                      </span>
                      <span className="chat-source-row__name">
                        {citation.document_name}
                      </span>
                      {citation.retrieval_meta ? (
                        <span
                          className={`chat-source-row__route chat-source-row__route--${kind}`}
                        >
                          {getRetrievalSourceLabel(kind)}
                        </span>
                      ) : null}
                      <span className="chat-source-row__score">
                        {typeof preferredScore === 'number'
                          ? `${
                              preferredLabel === '精排' ? 'R' : 'V'
                            } ${Math.round(preferredScore * 100)}%`
                          : typeof keywordRank === 'number'
                            ? `K #${keywordRank}`
                            : typeof citation.score === 'number'
                              ? `${Math.round(citation.score * 100)}%`
                              : '—'}
                      </span>
                    </button>
                  )
                })
              ) : (
                <p className="chat-signal__empty">
                  生成回答后，命中片段会按相关度显示在这里。
                </p>
              )}
            </div>
          </div>

          <p className="chat-rail__footnote">
            `message_start → query_route → agent_steps`
            <br />
            `citations → token → verify_result → message_end`
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
                  问一个具体问题，Agent 会先规划检索并在信息不足时改写查询或切换策略，
                  混合检索结果会经过 RRF 融合与 rerank 精排，答案再通过引用可信度校验后
                  输出。决策轨迹、路由快照、检索排名和校验结果都会随消息保留。
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
                              {message.agentSteps
                                ? `Agent ${message.agentSteps.length} 轮完成 · 正在生成回答`
                                : message.queryRoute
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

                      {isAssistant ? (
                        <AnswerVerifyNotice result={message.verifyResult} />
                      ) : null}

                      {isAssistant && message.agentSteps ? (
                        <AgentStepsPanel
                          steps={message.agentSteps}
                          live={streaming && isLast}
                        />
                      ) : null}

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

                      {isAssistant ? (
                        <RetrievalMetaPanel
                          citations={message.citations}
                          live={streaming && isLast}
                        />
                      ) : null}

                      {isAssistant && message.citations.length > 0 ? (
                        <div className="chat-message__sources">
                          {message.citations.map((citation) => {
                            const kind = getRetrievalSourceKind(
                              citation.retrieval_meta,
                            )

                            return (
                              <button
                                type="button"
                                className="chat-source-chip"
                                key={`${citation.ordinal}-${citation.document_name}`}
                                onClick={() => openCitation(citation)}
                                disabled={!citation.document_id}
                                title={citationTitle(citation)}
                              >
                                <span>[{citation.ordinal}]</span>
                                {citation.document_name}
                                {citation.page_no
                                  ? ` · p.${citation.page_no}`
                                  : ''}
                                {citation.retrieval_meta ? (
                                  <i
                                    className={`chat-source-chip__route chat-source-chip__route--${kind}`}
                                  >
                                    {getRetrievalSourceLabel(kind)}
                                  </i>
                                ) : null}
                              </button>
                            )
                          })}
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

          <RetrievalFilterBar
            value={filters}
            onChange={(next) => {
              setFilters(next)
              setError(null)
            }}
            disabled={streaming}
          />

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
