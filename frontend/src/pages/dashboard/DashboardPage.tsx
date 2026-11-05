import { LayoutGroup, MotionConfig, motion, useReducedMotion, type Variants } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '../../app/Link'
import { paths } from '../../app/router'
import { useSession } from '../../auth/useAuth'
import { AccountMenu } from '../../components/AccountMenu'
import { FileThumb } from '../../components/FileThumb'
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BrandMark,
  ChatIcon,
  DashboardIcon,
  DatabaseIcon,
  FileIcon,
  FlaskIcon,
  ServerIcon,
  ShieldIcon,
  SparkIcon,
  TrendIcon,
} from '../../components/Icons'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { DocumentStatusBadge, StatusBadge } from '../../components/StatusBadge'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { fileKindFromMime, type Tone } from '../../lib/documents'
import { formatNumber, formatRelative } from '../../lib/format'
import {
  DEMO_DATA,
  MODULES,
  PERIODS,
  type ModuleId,
  type PeriodData,
  type PeriodKey,
} from './dashboardData'
import { AnimatedNumber, PulseChart, Sparkline } from './DashboardVisuals'
import { Dock, type DockItem } from './Dock'
import { useDashboardLive, type HealthLevel, type LiveDocuments, type LiveHealth } from './useDashboardLive'
import { useTilt } from './useTilt'
import './DashboardPage.css'

type View = 'overview' | 'trends' | 'insights'

const VIEWS: { key: View; label: string; module: ModuleId | null }[] = [
  { key: 'overview', label: '总览', module: null },
  { key: 'trends', label: '趋势', module: 'domains' },
  { key: 'insights', label: '洞察', module: 'insights' },
]

const HEALTH_META: Record<HealthLevel, { tone: Tone; label: string; detail: string }> = {
  checking: { tone: 'pending', label: '检测中', detail: '正在检查后端与数据库' },
  ok: { tone: 'success', label: '全部在线', detail: 'API 与数据库运行正常' },
  degraded: { tone: 'warning', label: '部分降级', detail: 'API 在线，数据库检查未通过' },
  down: { tone: 'danger', label: '服务离线', detail: '无法连接后端 API' },
}

const LAYOUT_SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const

const pageVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}

const blockVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 0.8, 0.22, 1] } },
}

function todayLabel() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`
}

export function DashboardPage() {
  useDocumentTitle('数据看板')
  const { isAdmin } = useSession()
  const reduceMotion = useReducedMotion()
  const [period, setPeriod] = useState<PeriodKey>('week')
  const [expanded, setExpanded] = useState<ModuleId | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const live = useDashboardLive()
  const data = DEMO_DATA[period]
  const periodMeta = PERIODS.find((item) => item.key === period) ?? PERIODS[0]
  const activeView: View = VIEWS.find((view) => view.module && view.module === expanded)?.key ?? 'overview'

  useEffect(() => {
    if (!expanded) return
    backRef.current?.focus({ preventScroll: true })
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  function openModule(id: ModuleId | null, scroll = false) {
    setExpanded(id)
    const behavior = reduceMotion ? 'auto' : 'smooth'
    if (id === null && scroll) window.scrollTo({ top: 0, behavior })
    else if (id && scroll) workspaceRef.current?.scrollIntoView({ behavior, block: 'start' })
  }

  function selectView(view: View, scroll: boolean) {
    const target = VIEWS.find((item) => item.key === view)
    openModule(target?.module ?? null, scroll)
  }

  const dockItems: DockItem[] = [
    ...VIEWS.map((view) => ({
      key: view.key,
      label: view.label,
      group: 'view',
      icon:
        view.key === 'overview' ? (
          <DashboardIcon size={20} />
        ) : view.key === 'trends' ? (
          <TrendIcon size={20} />
        ) : (
          <SparkIcon size={20} />
        ),
      active: activeView === view.key,
      onSelect: () => selectView(view.key, true),
    })),
    { key: 'documents', label: '文档库', group: 'nav', icon: <FileIcon size={20} />, to: paths.documents() },
    { key: 'chat', label: '知识问答', group: 'nav', icon: <ChatIcon size={20} />, to: paths.chat() },
    ...(isAdmin
      ? [
          {
            key: 'evaluations',
            label: '评测中心',
            group: 'nav',
            icon: <FlaskIcon size={20} />,
            to: paths.evaluations(),
          },
          {
            key: 'access',
            label: '用户与权限',
            group: 'nav',
            icon: <ShieldIcon size={20} />,
            to: paths.access(),
          },
        ]
      : []),
    { key: 'status', label: '系统状态', group: 'nav', icon: <ServerIcon size={20} />, to: paths.status() },
  ]

  return (
    <MotionConfig reducedMotion="user">
      <div className="dash">
        <a className="skip-link" href="#dash-main">
          跳到主要内容
        </a>
        <header className="dash-header">
          <Link to={paths.dashboard()} className="dash-brand" aria-label="RAG Atelier 数据看板">
            <span className="dash-brand__mark">
              <BrandMark size={22} />
            </span>
            <span className="dash-brand__text">
              <strong>RAG ATELIER</strong>
              <span>知识智能中枢</span>
            </span>
          </Link>

          <nav className="dash-nav" aria-label="看板视图">
            {VIEWS.map((view) => (
              <button
                key={view.key}
                type="button"
                className="dash-nav__item"
                aria-pressed={activeView === view.key}
                onClick={() => selectView(view.key, view.key !== 'overview')}
              >
                {activeView === view.key ? (
                  <motion.span layoutId="dash-nav-pill" className="dash-nav__pill" transition={LAYOUT_SPRING} />
                ) : null}
                <span className="dash-nav__label">{view.label}</span>
              </button>
            ))}
          </nav>

          <div className="dash-header__tools">
            <div className="dash-period" role="group" aria-label="统计周期（演示数据）">
              {PERIODS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="dash-period__item"
                  aria-pressed={period === item.key}
                  onClick={() => setPeriod(item.key)}
                >
                  {period === item.key ? (
                    <motion.span
                      layoutId="dash-period-pill"
                      className="dash-period__pill"
                      transition={{ type: 'spring', stiffness: 460, damping: 30 }}
                    />
                  ) : null}
                  <span className="dash-period__label">{item.label}</span>
                </button>
              ))}
            </div>
            <AccountMenu />
          </div>
        </header>

        <motion.main
          id="dash-main"
          className="dash-main"
          variants={pageVariants}
          initial="hidden"
          animate="show"
        >
          <motion.section className="dash-hero" variants={blockVariants}>
            <div className="dash-hero__copy">
              <span className="eyebrow">Knowledge Intelligence · {todayLabel()}</span>
              <h1 className="dash-hero__title">
                把知识，
                <span>凝成光。</span>
              </h1>
              <p className="hero-lead">
                文档在这里被解析、切分、向量化，再以带引用的回答回到每个人手中。
                看板汇总知识库的规模、服务健康与问答趋势，帮你判断下一步该补充什么。
              </p>
              <div className="hero-tags">
                <StatusBadge
                  tone={HEALTH_META[live.health.level].tone}
                  label={`实时 · ${HEALTH_META[live.health.level].label}`}
                  live={live.health.level === 'ok' || live.health.level === 'checking'}
                />
                <span className="chip">
                  覆盖 {live.documents ? formatNumber(live.documents.total) : '—'} 份文档
                </span>
                <span className="chip">
                  {live.documents ? formatNumber(live.documents.ready) : '—'} 份可检索
                </span>
              </div>
            </div>
            <HealthOrb health={live.health} documents={live.documents} />
          </motion.section>

          <motion.section className="dash-section" variants={blockVariants} aria-labelledby="dash-metrics-title">
            <div className="dash-section__head">
              <div>
                <span className="eyebrow">{periodMeta.caption}</span>
                <h2 id="dash-metrics-title" className="section-title">
                  问答表现
                </h2>
              </div>
              <DemoNote />
            </div>
            <div className="dash-metrics">
              {data.metrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          </motion.section>

          <motion.section
            ref={workspaceRef}
            className="dash-section dash-workspace"
            variants={blockVariants}
            aria-labelledby="dash-workspace-title"
          >
            <div className="dash-section__head">
              <div>
                <span className="eyebrow">Workspace</span>
                <h2 id="dash-workspace-title" className="section-title">
                  知识工作台
                </h2>
              </div>
              <span className="faint dash-section__hint">点击模块原位展开，Esc 或「返回总览」收起</span>
            </div>

            <LayoutGroup id="dash-modules">
              {expanded ? (
                <div className="dash-expanded">
                  <motion.article
                    layoutId={`dash-module-${expanded}`}
                    className="dash-module dash-module--detail glass"
                    transition={LAYOUT_SPRING}
                  >
                    <ModuleHeader id={expanded}>
                      <button
                        ref={backRef}
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => openModule(null)}
                      >
                        <ArrowLeftIcon size={14} />
                        返回总览
                      </button>
                    </ModuleHeader>
                    <motion.div
                      key={expanded}
                      className="dash-module__body"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.25 } }}
                    >
                      <ModuleContent id={expanded} data={data} live={live} detail />
                    </motion.div>
                  </motion.article>

                  <ul className="dash-strip" aria-label="其他模块">
                    {MODULES.filter((module) => module.id !== expanded).map((module) => (
                      <li key={module.id}>
                        <motion.button
                          type="button"
                          layoutId={`dash-module-${module.id}`}
                          className="dash-strip__item"
                          transition={LAYOUT_SPRING}
                          onClick={() => openModule(module.id)}
                        >
                          <span className="dash-strip__eyebrow">{module.eyebrow}</span>
                          <strong>{module.title}</strong>
                        </motion.button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="dash-grid">
                  {MODULES.map((module) => (
                    <motion.article
                      key={module.id}
                      layoutId={`dash-module-${module.id}`}
                      className={`dash-module dash-module--${module.id} soft-card`}
                      transition={LAYOUT_SPRING}
                    >
                      <ModuleHeader id={module.id}>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => openModule(module.id)}
                          aria-label={`展开${module.title}`}
                          title="展开"
                        >
                          <ArrowUpRightIcon size={16} />
                        </button>
                      </ModuleHeader>
                      <motion.div
                        className="dash-module__body"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { delay: 0.1, duration: 0.25 } }}
                      >
                        <ModuleContent id={module.id} data={data} live={live} detail={false} />
                      </motion.div>
                    </motion.article>
                  ))}
                </div>
              )}
            </LayoutGroup>
          </motion.section>
        </motion.main>

        <Dock items={dockItems} />
      </div>
    </MotionConfig>
  )
}

function DemoNote() {
  return (
    <span className="dash-demo" title="后端暂无统计聚合接口，该区域使用前端内置的演示数据">
      <span className="dot" aria-hidden="true" />
      演示数据
    </span>
  )
}

function HealthOrb({ health, documents }: { health: LiveHealth; documents: LiveDocuments | null }) {
  const meta = HEALTH_META[health.level]
  const dbLabel =
    health.db?.status === 'ok' ? '正常' : health.db?.status === 'not_configured' ? '未配置' : health.db ? '异常' : '—'
  return (
    <div className="dash-orb-wrap">
      <div className="dash-orb" data-level={health.level} aria-hidden="true">
        <span className="dash-orb__ring dash-orb__ring--outer">
          <span className="dash-orb__satellite" />
        </span>
        <span className="dash-orb__ring dash-orb__ring--inner">
          <span className="dash-orb__satellite dash-orb__satellite--small" />
        </span>
        <span className="dash-orb__glow" />
        <span className="dash-orb__core">
          <strong className="num">{documents ? formatNumber(documents.total) : '—'}</strong>
          <span>份知识文档</span>
        </span>
      </div>
      <div className="dash-orb__panel dark-block" role="status">
        <div className="dash-orb__status">
          <StatusBadge tone={meta.tone} label={meta.label} live={health.level === 'checking'} />
          <span>{meta.detail}</span>
        </div>
        <dl className="dash-orb__facts">
          <div>
            <dt>
              <ServerIcon size={14} />
              API
            </dt>
            <dd>{health.api ? (health.api.status === 'ok' ? '在线' : '异常') : health.level === 'down' ? '离线' : '—'}</dd>
          </div>
          <div>
            <dt>
              <DatabaseIcon size={14} />
              数据库
            </dt>
            <dd>{dbLabel}</dd>
          </div>
          <div>
            <dt>
              <FileIcon size={14} />
              处理失败
            </dt>
            <dd className="num">{documents ? formatNumber(documents.failed) : '—'}</dd>
          </div>
        </dl>
        <Link to={paths.status()} className="dash-orb__link">
          查看系统状态
          <ArrowUpRightIcon size={14} />
        </Link>
      </div>
    </div>
  )
}

function MetricCard({ metric }: { metric: PeriodData['metrics'][number] }) {
  const tilt = useTilt()
  return (
    <motion.article
      className="dash-metric soft-card"
      style={tilt.style}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
    >
      <span className="dash-metric__label">{metric.label}</span>
      <strong className="dash-metric__value num">
        <AnimatedNumber value={metric.value} digits={metric.digits} />
        <small>{metric.unit}</small>
      </strong>
      <span className="dash-metric__delta" data-positive={metric.positive}>
        {metric.direction === 'up' ? '↑' : '↓'} {metric.delta}
        <span className="faint">{metric.hint}</span>
      </span>
      <Sparkline values={metric.spark} positive={metric.positive} />
    </motion.article>
  )
}

function ModuleHeader({ id, children }: { id: ModuleId; children: ReactNode }) {
  const module = MODULES.find((item) => item.id === id)
  if (!module) return null
  return (
    <header className="dash-module__head">
      <div>
        <span className="eyebrow">{module.eyebrow}</span>
        <h3 className="dash-module__title">{module.title}</h3>
      </div>
      <div className="dash-module__actions">
        {module.demo ? <DemoNote /> : <StatusBadge tone="success" label="实时" />}
        {children}
      </div>
    </header>
  )
}

interface ModuleContentProps {
  id: ModuleId
  data: PeriodData
  live: ReturnType<typeof useDashboardLive>
  detail: boolean
}

function ModuleContent({ id, data, live, detail }: ModuleContentProps) {
  switch (id) {
    case 'pulse':
      return <PulseModule data={data} detail={detail} />
    case 'domains':
      return <DomainsModule data={data} detail={detail} />
    case 'insights':
      return <InsightsModule data={data} detail={detail} />
    case 'sources':
      return <SourcesModule data={data} detail={detail} />
    case 'ai':
      return <AiModule data={data} detail={detail} />
    case 'recent':
      return <RecentModule live={live} detail={detail} />
  }
}

function PulseModule({ data, detail }: { data: PeriodData; detail: boolean }) {
  const queries = data.pulse.map((point) => point.queries)
  const hitRates = data.pulse.map((point) => point.hitRate)
  const peak = data.pulse.reduce((best, point) => (point.queries > best.queries ? point : best), data.pulse[0])
  const avgHit = hitRates.reduce((sum, value) => sum + value, 0) / hitRates.length
  return (
    <>
      <div className="dash-legend" aria-hidden="true">
        <span data-series="queries">问答量</span>
        <span data-series="hits">命中率</span>
      </div>
      <PulseChart queries={queries} hitRates={hitRates} labels={data.pulse.map((point) => point.label)} />
      <dl className="dash-kv">
        <div>
          <dt>峰值时段</dt>
          <dd>
            {peak.label} · <span className="num">{formatNumber(peak.queries)}</span> 次
          </dd>
        </div>
        <div>
          <dt>平均命中率</dt>
          <dd className="num">{avgHit.toFixed(1)}%</dd>
        </div>
        <div>
          <dt>合计问答</dt>
          <dd className="num">{formatNumber(queries.reduce((sum, value) => sum + value, 0))}</dd>
        </div>
      </dl>
      {detail ? (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <caption className="sr-only">各时段问答量与命中率</caption>
            <thead>
              <tr>
                <th scope="col">时段</th>
                <th scope="col">问答量</th>
                <th scope="col">命中率</th>
              </tr>
            </thead>
            <tbody>
              {data.pulse.map((point) => (
                <tr key={point.label}>
                  <th scope="row">{point.label}</th>
                  <td className="num">{formatNumber(point.queries)}</td>
                  <td className="num">{point.hitRate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  )
}

function DomainsModule({ data, detail }: { data: PeriodData; detail: boolean }) {
  const rows = detail ? data.domains : data.domains.slice(0, 4)
  const max = Math.max(...data.domains.map((domain) => domain.value))
  return (
    <ul className="dash-bars">
      {rows.map((domain) => (
        <li key={domain.label}>
          <div className="dash-bars__row">
            <span>{domain.label}</span>
            <span className="num">
              {formatNumber(domain.value)}
              <em data-positive={domain.change >= 0}>
                {domain.change >= 0 ? '+' : ''}
                {domain.change.toFixed(1)}%
              </em>
            </span>
          </div>
          <span className="dash-bars__track" aria-hidden="true">
            <motion.span
              className="dash-bars__fill"
              initial={false}
              animate={{ scaleX: domain.value / max }}
              transition={{ type: 'spring', stiffness: 160, damping: 26 }}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}

function InsightsModule({ data, detail }: { data: PeriodData; detail: boolean }) {
  const rows = detail ? data.insights : data.insights.slice(0, 2)
  return (
    <ul className="dash-insights" data-detail={detail}>
      {rows.map((insight) => (
        <li key={insight.title} className="dash-insight" data-tone={insight.tone}>
          <span className="dash-insight__dot" aria-hidden="true" />
          <div>
            <strong>{insight.title}</strong>
            {detail ? <p>{insight.body}</p> : null}
          </div>
          <span className="dash-insight__metric num">{insight.metric}</span>
        </li>
      ))}
    </ul>
  )
}

function SourcesModule({ data, detail }: { data: PeriodData; detail: boolean }) {
  const rows = detail ? data.sources : data.sources.slice(0, 3)
  return (
    <ol className="dash-sources">
      {rows.map((source, index) => (
        <li key={source.name}>
          <span className="dash-sources__rank num">{String(index + 1).padStart(2, '0')}</span>
          <div className="dash-sources__main">
            <strong>{source.name}</strong>
            <span className="faint">
              {source.domain} · {formatNumber(source.hits)} 次引用
            </span>
            {detail ? (
              <span className="dash-bars__track" aria-hidden="true">
                <motion.span
                  className="dash-bars__fill"
                  initial={false}
                  animate={{ scaleX: source.share / data.sources[0].share }}
                  transition={{ type: 'spring', stiffness: 160, damping: 26 }}
                />
              </span>
            ) : null}
          </div>
          <span className="dash-sources__share num">{(source.share * 100).toFixed(0)}%</span>
        </li>
      ))}
    </ol>
  )
}

function AiModule({ data, detail }: { data: PeriodData; detail: boolean }) {
  return (
    <div className="dash-ai">
      <p className="dash-ai__headline">{data.ai.headline}</p>
      {detail ? (
        <>
          <p className="dash-ai__body">{data.ai.body}</p>
          <h4 className="dash-ai__subtitle">建议动作</h4>
          <ul className="dash-ai__list">
            {data.ai.suggestions.map((suggestion) => (
              <li key={suggestion}>
                <SparkIcon size={14} />
                {suggestion}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <span className="faint dash-ai__more">{data.ai.suggestions.length} 条建议动作</span>
      )}
    </div>
  )
}

function RecentModule({ live, detail }: { live: ReturnType<typeof useDashboardLive>; detail: boolean }) {
  const { documents, documentsError, reload } = live
  if (documentsError && !documents) {
    return <ErrorState message={documentsError} onRetry={() => void reload()} />
  }
  if (!documents) {
    return (
      <div className="dash-recent">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} height={44} radius={14} />
        ))}
      </div>
    )
  }
  if (!documents.recent.length) {
    return (
      <EmptyState
        icon={<FileIcon size={22} />}
        title="还没有沉淀任何文档"
        action={
          <Link to={paths.documents()} className="btn btn--primary btn--sm">
            去上传文档
          </Link>
        }
      />
    )
  }
  const rows = detail ? documents.recent : documents.recent.slice(0, 3)
  return (
    <>
      <ul className="dash-recent">
        {rows.map((document) => (
          <li key={document.id}>
            <Link to={paths.document(document.id)} className="dash-recent__item">
              {detail ? (
                <FileThumb kind={fileKindFromMime(document.mime_type)} src={document.thumbnail_url} variant="tile" />
              ) : null}
              <span className="dash-recent__main">
                <strong>{document.name}</strong>
                <span className="faint">
                  {formatRelative(document.created_at)} · v{document.version}
                </span>
              </span>
              <DocumentStatusBadge status={document.status} />
            </Link>
          </li>
        ))}
      </ul>
      {detail ? (
        <Link to={paths.documents()} className="btn btn--ghost btn--sm dash-recent__all">
          进入文档库查看全部 {formatNumber(documents.total)} 份
          <ArrowUpRightIcon size={14} />
        </Link>
      ) : null}
    </>
  )
}
