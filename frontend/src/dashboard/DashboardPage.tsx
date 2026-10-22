import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
} from 'framer-motion'
import {
  DASHBOARD_DATA,
  DEFAULT_PERIOD,
  MODULE_ORDER,
  formatNumber,
  type DashboardView,
  type Metric,
  type ModuleKey,
  type PeriodData,
  type PeriodKey,
} from './dashboardData'
import { AnimatedNumber } from './components/AnimatedNumber'
import { clearNumberMemory } from './numberMemory'
import { DashboardDock } from './components/DashboardDock'
import { GlassNav } from './components/GlassNav'
import { LiquidTimeFilter } from './components/LiquidTimeFilter'
import { ModuleGridContent } from './components/ModuleCards'
import { MODULE_META } from './moduleMeta'
import { ModuleOverlay } from './components/ModuleOverlay'
import { TiltCard } from './components/TiltCard'
import { ArrowUpIcon, ClockIcon, ExpandIcon, SparkIcon } from './icons'
import './DashboardPage.css'

export type DashboardDestination = 'documents' | 'chat' | 'status'

interface DashboardPageProps {
  onNavigate: (view: DashboardDestination) => void
}

const MODULE_LAYOUT_SPRING = {
  layout: {
    type: 'spring' as const,
    stiffness: 250,
    damping: 30,
    mass: 0.82,
  },
}

function getDateLabel() {
  const now = new Date()
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(now)
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
  }).format(now)

  return `${date} · ${weekday}`
}

function MetricBlock({ metric, index }: { metric: Metric; index: number }) {
  return (
    <div className="dash-metric">
      <div className="dash-metric__top">
        <span className="dash-metric__label">{metric.label}</span>
        <span className="dash-metric__index">
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>
      <div className="dash-metric__body">
        <div className="dash-metric__number">
          <AnimatedNumber
            value={metric.value}
            valueKey={`dashboard-metric-${metric.id}`}
            ariaLabel={`${metric.label} ${formatNumber(metric.value)} ${metric.unit}`}
          />
          <span className="dash-metric__unit">{metric.unit}</span>
        </div>
        <div className="dash-metric__spark" aria-hidden="true">
          {metric.spark.map((height, sparkIndex) => (
            <i
              key={sparkIndex}
              style={{
                height: `${height}%`,
                opacity: 0.34 + sparkIndex * 0.075,
              }}
            />
          ))}
        </div>
      </div>
      <div className="dash-metric__foot">
        <span className="dash-metric__delta">
          <ArrowUpIcon />
          {metric.delta}
        </span>
        <span>{metric.comparison}</span>
      </div>
    </div>
  )
}

function HealthOrb({ data }: { data: PeriodData }) {
  return (
    <aside
      className="health-orb"
      aria-label={`知识健康度 ${data.health} 分，较上期 ${data.healthDelta}，语义覆盖 ${data.semanticCoverage}`}
    >
      <div className="health-orb__stage">
        <span className="health-orb__halo" aria-hidden="true" />
        <span className="health-orb__orbit health-orb__orbit--outer" aria-hidden="true">
          <i />
        </span>
        <span className="health-orb__orbit health-orb__orbit--inner" aria-hidden="true">
          <i />
        </span>
        <div className="health-orb__glass">
          <span className="health-orb__eyebrow">KNOWLEDGE HEALTH</span>
          <div className="health-orb__score">
            <AnimatedNumber
              value={data.health}
              valueKey="dashboard-health-score"
              ariaLabel={`知识健康度 ${data.health} 分`}
            />
            <span>/ 100</span>
          </div>
          <span className="health-orb__delta">
            <ArrowUpIcon />
            较上期 {data.healthDelta}
          </span>
          <span className="health-orb__coverage">
            语义覆盖 <b>{data.semanticCoverage}</b>
          </span>
        </div>
      </div>
    </aside>
  )
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const [period, setPeriod] = useState<PeriodKey>(DEFAULT_PERIOD)
  const [activeView, setActiveView] = useState<DashboardView>('overview')
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const lastTriggeredModule = useRef<ModuleKey>('trend')
  const reduceMotion = useReducedMotion()
  const periodData = DASHBOARD_DATA[period]
  const dateLabel = getDateLabel()
  const isDetailOpen = activeModule !== null

  useEffect(() => {
    let frame = 0

    const updateHeader = () => {
      frame = 0
      setHeaderScrolled((previous) => {
        const next = window.scrollY > 18
        return previous === next ? previous : next
      })
    }

    const handleScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateHeader)
    }

    updateHeader()
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'RAG Atelier · 知识数据看板'
    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    if (!isDetailOpen) return

    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [isDetailOpen])

  const scrollToTop = useCallback(() => {
    window.scrollTo({
      top: 0,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [reduceMotion])

  const handleOverview = useCallback(() => {
    setActiveView('overview')
    scrollToTop()
  }, [scrollToTop])

  const openModule = useCallback((module: ModuleKey) => {
    lastTriggeredModule.current = module
    setActiveModule(module)
  }, [])

  const closeModule = useCallback(() => {
    const previousModule = lastTriggeredModule.current
    setActiveModule(null)

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-dashboard-module="${previousModule}"]`,
          )
          ?.focus({ preventScroll: true })
      })
    })
  }, [])

  const handleNavChange = useCallback(
    (view: DashboardView) => {
      setActiveView(view)

      if (view === 'overview') {
        scrollToTop()
        return
      }

      document
        .querySelector<HTMLElement>(`[data-dashboard-module="${view}"]`)
        ?.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        })
    },
    [reduceMotion, scrollToTop],
  )

  const handleDockModule = useCallback(
    (module: 'trend' | 'insight') => {
      setActiveView(module)
      openModule(module)
    },
    [openModule],
  )

  const handlePeriodChange = useCallback((nextPeriod: PeriodKey) => {
    clearNumberMemory('dashboard-source-')
    setPeriod(nextPeriod)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="rag-atelier-dashboard">
        <div className="dashboard-page">
          <div className="dash-atmosphere" aria-hidden="true">
            <span className="dash-atmosphere__glow" />
            <span className="dash-atmosphere__arc" />
            <span className="dash-atmosphere__ring" />
            <span className="dash-atmosphere__grain" />
          </div>

          <span className="dashboard-sr-only" aria-live="polite">
            {periodData.label}数据已更新，当前为{periodData.rangeLabel}
          </span>

          <div
            className="dashboard-stage"
            aria-hidden={isDetailOpen || undefined}
            inert={isDetailOpen || undefined}
          >
            <header
              className="dash-header"
              data-scrolled={headerScrolled ? 'true' : 'false'}
            >
              <button
                type="button"
                className="dash-brand"
                onClick={handleOverview}
                aria-label="回到总览顶部"
              >
                <span className="dash-brand__mark">
                  <SparkIcon />
                  <i aria-hidden="true" />
                </span>
                <span className="dash-brand__copy">
                  <strong>RAG ATELIER</strong>
                  <span>知识智能中枢</span>
                </span>
              </button>

              <GlassNav active={activeView} onChange={handleNavChange} />

              <div className="dash-header__actions">
                <LiquidTimeFilter
                  value={period}
                  onChange={handlePeriodChange}
                />
                <span className="dash-avatar" aria-label="林夏的账户">
                  林
                  <i aria-hidden="true" />
                </span>
              </div>
            </header>

            <section className="dash-hero" aria-labelledby="dashboard-title">
              <div className="dash-hero__copy">
                <p className="dash-eyebrow">
                  <span className="dash-eyebrow__line" aria-hidden="true" />
                  KNOWLEDGE INTELLIGENCE
                  <span className="dash-eyebrow__dot" aria-hidden="true" />
                  {dateLabel}
                </p>
                <h1 id="dashboard-title">
                  把知识，<span>凝成光。</span>
                </h1>
                <div className="dash-hero__sub">
                  <p>
                    让散落在文档、对话与洞察里的微光，汇成一张会呼吸的知识网络。
                  </p>
                  <div className="dash-hero__chips">
                    <span>
                      <i className="live-dot" aria-hidden="true" />
                      实时同步中
                    </span>
                    <span>覆盖 42 个工作空间</span>
                  </div>
                </div>
              </div>
              <HealthOrb data={periodData} />
            </section>

            <main className="dash-workbench">
              <section
                className="dash-panel"
                aria-labelledby="dashboard-pulse-title"
              >
                <header className="dash-panel__head">
                  <div className="dash-panel__title">
                    <span className="dash-panel__eyebrow">
                      <span className="live-dot" aria-hidden="true" />
                      LIVE OVERVIEW
                    </span>
                    <div className="dash-panel__heading">
                      <h2 id="dashboard-pulse-title">知识脉搏</h2>
                      <span className="dash-panel__range">
                        {periodData.rangeLabel}
                      </span>
                    </div>
                    <p>
                      团队知识资产与调用活性的实时切片。所有数字均以等宽字形对齐。
                    </p>
                  </div>
                  <div className="dash-panel__meta">
                    <span className="dash-panel__updated">
                      <ClockIcon />
                      {periodData.updatedAt} 更新
                    </span>
                    <span className="dash-panel__hint">
                      <ExpandIcon />
                      点击任一模块，沉浸查看
                    </span>
                  </div>
                </header>

                <div className="dash-metrics">
                  {periodData.metrics.map((metric, index) => (
                    <MetricBlock
                      key={metric.id}
                      metric={metric}
                      index={index}
                    />
                  ))}
                </div>

                <div
                  className={`dash-module-grid ${
                    isDetailOpen ? 'is-placeholder' : ''
                  }`}
                >
                  {isDetailOpen
                    ? MODULE_ORDER.map((module) => (
                        <div
                          key={module}
                          className={`dash-module-shell dash-module-shell--${module} dash-module-shell--ghost`}
                          aria-hidden="true"
                        />
                      ))
                    : MODULE_ORDER.map((module) => {
                        const meta = MODULE_META[module]

                        return (
                          <motion.article
                            key={module}
                            layoutId={`dashboard-module-${module}`}
                            className={`dash-module-shell dash-module-shell--${module}`}
                            data-dashboard-module={module}
                            role="button"
                            tabIndex={0}
                            aria-label={`展开${meta.title}详情`}
                            transition={MODULE_LAYOUT_SPRING}
                            onClick={() => openModule(module)}
                            onKeyDown={(event) => {
                              if (
                                event.key === 'Enter' ||
                                event.key === ' '
                              ) {
                                event.preventDefault()
                                openModule(module)
                              }
                            }}
                          >
                            <TiltCard tone={meta.tone}>
                              <ModuleGridContent
                                module={module}
                                data={periodData}
                              />
                            </TiltCard>
                          </motion.article>
                        )
                      })}
                </div>
              </section>
            </main>

            <footer className="dash-footer">
              <span>RAG ATELIER © 2026</span>
              <span>
                <i className="live-dot" aria-hidden="true" />
                所有系统运行平稳 · 索引持续同步
              </span>
            </footer>
          </div>

          {activeModule ? (
            <ModuleOverlay
              activeModule={activeModule}
              data={periodData}
              onClose={closeModule}
              onSelect={openModule}
            />
          ) : null}

          <DashboardDock
            hidden={isDetailOpen}
            onOverview={handleOverview}
            onOpenModule={handleDockModule}
            onNavigate={onNavigate}
          />
        </div>
      </LayoutGroup>
    </MotionConfig>
  )
}
