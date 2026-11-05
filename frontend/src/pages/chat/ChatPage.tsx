import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  streamChat,
  type ChatStreamHandlers,
} from '../../api/chat'
import { fetchHealth } from '../../api/health'
import { ApiError, errorMessage, isAbortError, RATE_LIMIT_MESSAGE } from '../../api/http'
import { navigate, paths } from '../../app/router'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  ChatIcon,
  ChevronDownIcon,
  CloseIcon,
  FilterIcon,
  PlusIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
} from '../../components/Icons'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { useToast } from '../../components/toast/useToast'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { FILTERABLE_MIME_TYPES } from '../../lib/documents'
import type { ChatMessage, ConversationListItem, ConversationRead, Page } from '../../types/api'
import { ChatFilterDialog } from './ChatFilterDialog'
import { ChatRail } from './ChatRail'
import {
  activeFilterCount,
  buildRetrievalFilters,
  citationFromStream,
  createAssistantPlaceholder,
  createUserMessage,
  EMPTY_FILTERS,
  messageFromRead,
  QUESTION_MAX_LENGTH,
  validateFilters,
  type FilterDraft,
} from './chatModel'
import { MessageItem } from './MessageItem'
import './ChatPage.css'

const LIST_STEP = 20
const LIST_MAX = 100
const STICK_THRESHOLD = 96

const SUGGESTIONS = [
  '知识库里有哪些主要文档？分别讲了什么？',
  '帮我总结最近上传文档的核心结论',
  '对比两份文档在同一问题上的观点差异',
  '这个流程的关键步骤和注意事项有哪些？',
]

const CAPABILITIES = ['混合检索 + RRF', 'Agentic 多轮检索', '精排 Rerank', '事实校验', '语义缓存', '引用溯源']

type HealthState = 'checking' | 'ok' | 'error'

interface DetailError {
  message: string
  notFound: boolean
}

export function ChatPage({ conversationId }: { conversationId: string | null }) {
  useDocumentTitle('知识问答')
  const toast = useToast()

  const [conversation, setConversation] = useState<ConversationRead | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<DetailError | null>(null)

  const [conversations, setConversations] = useState<Page<ConversationListItem> | null>(null)
  const [listSize, setListSize] = useState(LIST_STEP)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [filters, setFilters] = useState<FilterDraft>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [deleting, setDeleting] = useState<ConversationListItem | null>(null)
  const [health, setHealth] = useState<HealthState>('checking')
  const [showJump, setShowJump] = useState(false)

  const detailControllerRef = useRef<AbortController | null>(null)
  const listControllerRef = useRef<AbortController | null>(null)
  const streamControllerRef = useRef<AbortController | null>(null)
  /** 正在流式回答的会话；切换到其他会话时中断它。 */
  const streamConversationRef = useRef<string | null>(null)
  /** 新建会话后 URL 会变化，此时本地消息就是最新状态，不需要再拉取详情。 */
  const skipLoadRef = useRef<string | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const tokenBufferRef = useRef('')
  const frameRef = useRef<number | null>(null)

  // ---------- 会话列表 ----------

  const loadConversations = useCallback(
    async (options: { silent?: boolean } = {}) => {
      listControllerRef.current?.abort()
      const controller = new AbortController()
      listControllerRef.current = controller
      if (!options.silent) setListLoading(true)
      try {
        const result = await listConversations(1, listSize, controller.signal)
        setConversations(result)
        setListError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        setListError(errorMessage(caught, '会话列表加载失败'))
      } finally {
        if (listControllerRef.current === controller) setListLoading(false)
      }
    },
    [listSize],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0)
    return () => {
      window.clearTimeout(timer)
      listControllerRef.current?.abort()
    }
  }, [loadConversations])

  // ---------- 会话详情 ----------

  const loadDetail = useCallback(async (id: string) => {
    detailControllerRef.current?.abort()
    const controller = new AbortController()
    detailControllerRef.current = controller
    setDetailLoading(true)
    setDetailError(null)
    setMessages([])
    setConversation(null)
    try {
      const detail = await getConversation(id, controller.signal)
      setConversation(detail.conversation)
      setMessages(detail.messages.filter((message) => message.role !== 'system').map(messageFromRead))
      stickRef.current = true
    } catch (caught) {
      if (isAbortError(caught)) return
      const notFound = caught instanceof ApiError && caught.status === 404
      setDetailError({ message: errorMessage(caught, '会话加载失败'), notFound })
    } finally {
      if (detailControllerRef.current === controller) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    // 切换会话时中断上一个会话的流式回答
    if (streamConversationRef.current && streamConversationRef.current !== conversationId) {
      streamControllerRef.current?.abort()
    }
    const timer = window.setTimeout(() => {
      if (!conversationId) {
        detailControllerRef.current?.abort()
        setConversation(null)
        setMessages([])
        setDetailError(null)
        setDetailLoading(false)
        return
      }
      if (skipLoadRef.current === conversationId) {
        skipLoadRef.current = null
        return
      }
      void loadDetail(conversationId)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      detailControllerRef.current?.abort()
    }
  }, [conversationId, loadDetail])

  // 离开页面时中断流
  useEffect(
    () => () => {
      streamControllerRef.current?.abort()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  // ---------- 在线状态 ----------

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth('api', controller.signal)
      .then((result) => setHealth(result.status === 'ok' ? 'ok' : 'error'))
      .catch((caught: unknown) => {
        if (!isAbortError(caught)) setHealth('error')
      })
    return () => controller.abort()
  }, [])

  // ---------- 自动滚动 ----------

  useLayoutEffect(() => {
    const element = streamRef.current
    if (element && stickRef.current) element.scrollTop = element.scrollHeight
  }, [messages])

  function handleStreamScroll() {
    const element = streamRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const stick = distance < STICK_THRESHOLD
    stickRef.current = stick
    setShowJump(!stick)
  }

  function jumpToBottom() {
    const element = streamRef.current
    if (!element) return
    stickRef.current = true
    setShowJump(false)
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }

  // ---------- 发送 ----------

  function patchMessage(clientKey: string, patch: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current.map((message) => (message.clientKey === clientKey ? patch(message) : message)))
  }

  function flushTokens(clientKey: string) {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const chunk = tokenBufferRef.current
    if (!chunk) return
    tokenBufferRef.current = ''
    patchMessage(clientKey, (message) => ({ ...message, content: message.content + chunk }))
  }

  async function send(raw: string) {
    const question = raw.trim()
    if (!question || streaming) return
    if (question.length > QUESTION_MAX_LENGTH) {
      toast.error(`问题不能超过 ${QUESTION_MAX_LENGTH} 字`)
      return
    }
    const filterError = validateFilters(filters)
    if (filterError) {
      toast.error(filterError)
      return
    }

    const userMessage = createUserMessage(question)
    const assistant = createAssistantPlaceholder()
    const key = assistant.clientKey
    setMessages((current) => [...current, userMessage, assistant])
    setInput('')
    resizeInput(true)
    setStreaming(true)
    setAnnouncement('正在生成回答')
    stickRef.current = true
    setShowJump(false)

    const controller = new AbortController()
    streamControllerRef.current = controller
    tokenBufferRef.current = ''

    const handlers: ChatStreamHandlers = {
      onMessageStart: (data) => {
        setMessages((current) =>
          current.map((message) => {
            if (message.clientKey === userMessage.clientKey) return { ...message, id: data.user_message_id }
            if (message.clientKey === key) {
              return {
                ...message,
                traceId: data.trace_id,
                traceUrl: data.trace_url,
                cacheHit: Boolean(data.cache_hit),
              }
            }
            return message
          }),
        )
      },
      onQueryRoute: (route) => patchMessage(key, (message) => ({ ...message, queryRoute: route })),
      onAgentSteps: (steps) => patchMessage(key, (message) => ({ ...message, agentSteps: steps })),
      onCitations: (citations) =>
        patchMessage(key, (message) => ({ ...message, citations: citations.map(citationFromStream) })),
      onToken: (delta) => {
        if (!delta) return
        tokenBufferRef.current += delta
        // 每帧合并一次 token，避免逐字重渲染
        if (frameRef.current === null) {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null
            flushTokens(key)
          })
        }
      },
      onVerifyResult: (data) => {
        flushTokens(key)
        patchMessage(key, (message) => ({
          ...message,
          verifyResult: { verified: data.verified, reason: data.reason ?? null },
          // 校验失败时后端给出替换答案，整段替换已生成内容
          content: !data.verified && data.replacement_answer ? data.replacement_answer : message.content,
        }))
      },
      onMessageEnd: (data) => {
        flushTokens(key)
        patchMessage(key, (message) => ({
          ...message,
          id: data.message_id,
          refused: data.refused,
          status: 'done',
        }))
      },
    }

    let targetId = conversationId
    try {
      if (!targetId) {
        const created = await createConversation()
        targetId = created.id
        setConversation(created)
        streamConversationRef.current = targetId
        skipLoadRef.current = targetId
        navigate(paths.chat(targetId), { replace: true })
      } else {
        streamConversationRef.current = targetId
      }
      if (!controller.signal.aborted) {
        await streamChat(targetId, { question, filters: buildRetrievalFilters(filters) }, handlers, controller.signal)
      }
      flushTokens(key)
      if (controller.signal.aborted) {
        patchMessage(key, (message) => (message.status === 'streaming' ? { ...message, status: 'stopped' } : message))
        setAnnouncement('已停止生成')
      } else {
        patchMessage(key, (message) => (message.status === 'streaming' ? { ...message, status: 'done' } : message))
        setAnnouncement('回答已完成')
      }
    } catch (caught) {
      flushTokens(key)
      let message = errorMessage(caught, '生成回答失败，请稍后重试')
      if (caught instanceof ApiError && caught.status === 429) message = RATE_LIMIT_MESSAGE
      if (caught instanceof ApiError && caught.status === 401) message = '登录状态已失效，请重新登录'
      patchMessage(key, (current) => ({ ...current, status: 'error', errorMessage: message }))
      setAnnouncement(message)
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null
        streamConversationRef.current = null
        setStreaming(false)
      }
      // 首个问题会自动生成会话标题，刷新列表拿到新标题和消息数
      void loadConversations({ silent: true })
    }
  }

  function stop() {
    streamControllerRef.current?.abort()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send(input)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 中文输入法组词时的回车不发送
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send(input)
  }

  function resizeInput(reset = false) {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    if (!reset) element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }

  function startNewConversation() {
    if (streaming) return
    navigate(paths.chat())
    inputRef.current?.focus()
  }

  async function confirmDelete() {
    if (!deleting) return
    await deleteConversation(deleting.id)
    toast.success('会话已删除')
    const wasCurrent = deleting.id === conversationId
    setDeleting(null)
    if (wasCurrent) navigate(paths.chat(), { replace: true })
    void loadConversations({ silent: true })
  }

  // ---------- 派生数据 ----------

  const listItem = conversations?.items.find((item) => item.id === conversationId)
  const title = listItem?.title ?? conversation?.title ?? '新对话'
  const lastAnswer = [...messages].reverse().find((message) => message.role === 'assistant') ?? null
  const filterCount = activeFilterCount(filters)
  const canLoadMore = Boolean(conversations && conversations.total > conversations.items.length && listSize < LIST_MAX)
  const overLimit = input.length > QUESTION_MAX_LENGTH
  const showWelcome = !detailLoading && !detailError && messages.length === 0

  return (
    <main className="page chat-page">
      <section className="page-hero chat-hero">
        <div className="page-hero__copy">
          <span className="eyebrow">Knowledge Q&amp;A</span>
          <h1 className="hero-title">
            知识问答
            <span>与知识对话</span>
          </h1>
          <p className="hero-lead">
            问题先经路由改写，再由向量与关键词混合检索、RRF 融合与精排筛选证据；证据不足时 Agent 会换路重试或直接拒答，每个结论都附带可追溯的引用。
          </p>
        </div>
        <div className="page-hero__aside chat-hero__aside">
          <span className="chat-online" data-state={health}>
            <span className={health === 'checking' ? 'dot dot--live' : 'dot'} />
            {health === 'ok' ? '问答服务在线' : health === 'error' ? '后端服务不可用' : '正在检查服务'}
          </span>
          <ul className="chip-list chat-hero__caps">
            {CAPABILITIES.map((item) => (
              <li key={item} className="tech-tag">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="chat-layout">
        <ChatRail
          conversationId={conversationId}
          title={title}
          messageCount={messages.length}
          lastAnswer={lastAnswer}
          conversations={conversations}
          conversationsLoading={listLoading}
          conversationsError={listError}
          canLoadMore={canLoadMore}
          streaming={streaming}
          onNewConversation={startNewConversation}
          onReloadConversations={() => void loadConversations()}
          onLoadMore={() => setListSize((size) => Math.min(LIST_MAX, size + LIST_STEP))}
          onDelete={setDeleting}
        />

        <section className="glass chat-panel" aria-labelledby="chat-panel-title">
          <header className="chat-panel__head">
            <span className="chat-panel__avatar" aria-hidden="true">
              <SparkIcon size={18} />
            </span>
            <div className="chat-panel__title">
              <h2 id="chat-panel-title">知识库助手</h2>
              <span className="chat-panel__sub" title={title}>
                {conversationId ? title : '新对话 · 发送第一个问题后自动创建'}
              </span>
            </div>
            <span className="badge" data-tone={streaming ? 'accent' : health === 'error' ? 'danger' : 'success'}>
              <span className={streaming ? 'dot dot--live' : 'dot'} />
              {streaming ? '生成中' : health === 'error' ? '离线' : '在线'}
            </span>
          </header>

          <div className="chat-stream" ref={streamRef} onScroll={handleStreamScroll}>
            {detailLoading ? (
              <div className="chat-stream__skeleton" aria-label="正在加载会话">
                <Skeleton height={44} width="46%" radius={18} className="chat-skeleton--right" />
                <Skeleton height={120} width="78%" radius={18} />
                <Skeleton height={44} width="38%" radius={18} className="chat-skeleton--right" />
                <Skeleton height={96} width="70%" radius={18} />
              </div>
            ) : detailError ? (
              detailError.notFound ? (
                <EmptyState
                  icon={<ChatIcon size={26} />}
                  title="会话不存在或已删除"
                  description="它可能已在其他窗口被删除，开始一个新对话吧。"
                  action={
                    <button type="button" className="btn btn--primary" onClick={startNewConversation}>
                      <PlusIcon size={16} />
                      新对话
                    </button>
                  }
                />
              ) : (
                <ErrorState
                  message={detailError.message}
                  onRetry={() => conversationId && void loadDetail(conversationId)}
                />
              )
            ) : showWelcome ? (
              <div className="chat-welcome">
                <div className="chat-orb" aria-hidden="true">
                  <span className="chat-orb__core" />
                </div>
                <h3 className="chat-welcome__title">今天想从知识库里找到什么？</h3>
                <p className="chat-welcome__desc">
                  回答只基于你有权限访问的文档。找不到足够证据时，助手会明确告诉你，而不是编造答案。
                </p>
                <ul className="chat-suggest">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button type="button" className="chat-suggest__item" onClick={() => void send(suggestion)}>
                        <SparkIcon size={14} />
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="chat-messages" role="log" aria-label="对话消息">
                {messages
                  .filter((message) => message.role !== 'system')
                  .map((message) => (
                    <MessageItem key={message.clientKey} message={message} />
                  ))}
              </ol>
            )}
          </div>

          {showJump && messages.length ? (
            <button type="button" className="chat-jump" onClick={jumpToBottom}>
              <ChevronDownIcon size={15} />
              回到最新
            </button>
          ) : null}

          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>

          <form className="chat-composer" onSubmit={handleSubmit}>
            {filterCount ? <FilterSummary filters={filters} onClear={() => setFilters(EMPTY_FILTERS)} /> : null}
            <div className="chat-composer__box" data-over={overLimit || undefined}>
              <label htmlFor="chat-input" className="sr-only">
                输入问题
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
                className="chat-composer__input"
                rows={1}
                value={input}
                placeholder="向知识库提问，Enter 发送，Shift + Enter 换行"
                onChange={(event) => {
                  setInput(event.target.value)
                  resizeInput()
                }}
                onKeyDown={handleKeyDown}
                aria-describedby="chat-input-count"
              />
              <div className="chat-composer__bar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setFilterOpen(true)}
                  aria-haspopup="dialog"
                >
                  <FilterIcon size={14} />
                  检索过滤
                  {filterCount ? <span className="chat-composer__count num">{filterCount}</span> : null}
                </button>
                <span id="chat-input-count" className="chat-composer__limit num" data-over={overLimit || undefined}>
                  {input.length} / {QUESTION_MAX_LENGTH}
                </span>
                {streaming ? (
                  <button type="button" className="btn btn--dark btn--sm" onClick={stop}>
                    <StopIcon size={14} />
                    停止
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="btn btn--primary btn--sm"
                    disabled={!input.trim() || overLimit}
                  >
                    <SendIcon size={14} />
                    发送
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
      </div>

      {filterOpen ? (
        <ChatFilterDialog
          value={filters}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilters(next)
            setFilterOpen(false)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除会话"
        description={
          <>
            确定删除「{deleting?.title}」吗？其中的 <span className="num">{deleting?.message_count ?? 0}</span>{' '}
            条消息和引用记录会一并删除，无法恢复。
          </>
        }
        confirmLabel="删除"
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </main>
  )
}

function FilterSummary({ filters, onClear }: { filters: FilterDraft; onClear: () => void }) {
  const parts: string[] = []
  if (filters.mimeTypes.length) {
    const labels = filters.mimeTypes.map(
      (mime) => FILTERABLE_MIME_TYPES.find((option) => option.value === mime)?.label ?? mime,
    )
    parts.push(`类型：${labels.join('、')}`)
  }
  if (filters.createdFrom || filters.createdTo) {
    parts.push(`时间：${filters.createdFrom || '不限'} 至 ${filters.createdTo || '不限'}`)
  }
  if (filters.documents.length) parts.push(`指定 ${filters.documents.length} 个文档`)
  return (
    <div className="chat-filter-summary">
      <FilterIcon size={13} />
      <span className="chat-filter-summary__text">{parts.join(' · ')}</span>
      <button type="button" className="icon-btn" onClick={onClear} aria-label="清除检索过滤" title="清除检索过滤">
        <CloseIcon size={13} />
      </button>
    </div>
  )
}
