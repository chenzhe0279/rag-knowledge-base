import type { CSSProperties, ReactNode } from 'react'
import type { ModuleKey, PeriodData } from '../dashboardData'
import { formatNumber } from '../dashboardData'
import { AnimatedNumber } from './AnimatedNumber'
import { TrendChart } from './TrendChart'
import { MODULE_META, getModuleThumbMetric } from '../moduleMeta'
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  ExpandIcon,
  SparkIcon,
} from '../icons'

function ModuleHeading({
  module,
  aside,
  showExpand = true,
}: {
  module: ModuleKey
  aside?: ReactNode
  showExpand?: boolean
}) {
  const meta = MODULE_META[module]
  const Icon = meta.icon

  return (
    <header className="module-heading">
      <div className="module-heading__main">
        <span className="module-heading__icon">
          <Icon />
        </span>
        <span className="module-heading__copy">
          <span className="module-heading__eyebrow">{meta.eyebrow}</span>
          <h3>{meta.title}</h3>
        </span>
      </div>
      <div className="module-heading__aside">
        {aside}
        {showExpand ? (
          <span className="module-expand" aria-hidden="true">
            <ExpandIcon />
            <span>展开</span>
          </span>
        ) : null}
      </div>
    </header>
  )
}

function LiveDot() {
  return <span className="live-dot" aria-hidden="true" />
}

function SourceRow({
  source,
  index,
  detail = false,
}: {
  source: PeriodData['sources'][number]
  index: number
  detail?: boolean
}) {
  return (
    <li className={`source-row ${detail ? 'source-row--detail' : ''}`}>
      <span className="source-row__rank">
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className="source-row__copy">
        <strong>{source.name}</strong>
        <span>
          {source.category}
          <i aria-hidden="true">·</i>
          {source.documents} 份文档
        </span>
        {detail ? (
          <span className="source-row__meter" aria-hidden="true">
            <span style={{ width: `${source.share}%` }} />
          </span>
        ) : null}
      </span>
      <span className="source-row__value">
        <strong>
          {detail ? (
            formatNumber(source.calls)
          ) : (
            <AnimatedNumber
              value={source.calls}
              valueKey={`dashboard-source-${source.id}`}
            />
          )}
        </strong>
        <small>次引用</small>
        <em>{source.delta}</em>
      </span>
    </li>
  )
}

function ActivityTable({
  rows,
  detail = false,
}: {
  rows: PeriodData['activity']
  detail?: boolean
}) {
  return (
    <div
      className={`activity-table ${detail ? 'activity-table--detail' : ''}`}
      role="table"
      aria-label="最近更新的知识文档"
    >
      <div className="activity-table__head" role="row">
        <span role="columnheader">文档</span>
        <span role="columnheader">贡献者</span>
        <span role="columnheader">切片</span>
        <span role="columnheader">更新时间</span>
      </div>
      <div className="activity-table__body" role="rowgroup">
        {rows.map((row) => {
          const stateClass =
            row.status === '解析中'
              ? 'is-processing'
              : row.status === '已更新'
                ? 'is-updated'
                : 'is-ready'

          return (
            <div className="activity-row" role="row" key={row.id}>
              <div className="activity-doc" role="cell">
                <span
                  className={`activity-format activity-format--${row.format.toLowerCase()}`}
                >
                  {row.format}
                </span>
                <span className="activity-doc__copy">
                  <strong>{row.name}</strong>
                  <span className={`activity-status ${stateClass}`}>
                    <i aria-hidden="true" />
                    {row.status}
                  </span>
                </span>
              </div>
              <div className="activity-contributor" role="cell">
                <span className="activity-avatar" aria-hidden="true">
                  {row.initials}
                </span>
                <span>{row.contributor}</span>
              </div>
              <div className="activity-chunks" role="cell">
                <strong>{formatNumber(row.chunks)}</strong>
                <span>切片</span>
              </div>
              <div className="activity-time" role="cell">
                <span>{row.updatedAt}</span>
                <small>{detail ? '自动索引完成' : '刚刚同步'}</small>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrendModule({ data }: { data: PeriodData }) {
  return (
    <div className="module-content module-content--trend">
      <ModuleHeading
        module="trend"
        aside={
          <span className="module-live">
            <LiveDot />
            实时
          </span>
        }
      />
      <div className="trend-summary">
        <div className="trend-summary__main">
          <span className="module-kicker">调用总量</span>
          <div className="trend-summary__number">
            <AnimatedNumber
              value={data.chart.total}
              valueKey="dashboard-trend-total"
              ariaLabel={`调用总量 ${formatNumber(data.chart.total)} 次`}
            />
            <span className="trend-summary__unit">次</span>
            <span className="trend-delta">
              <ArrowUpIcon />
              {data.chart.delta}
            </span>
          </div>
        </div>
        <div className="trend-summary__goal">
          <span>目标达成</span>
          <strong>
            {data.chart.completion}
            <small>%</small>
          </strong>
        </div>
      </div>
      <div className="trend-chart-shell">
        <TrendChart data={data.chart} />
      </div>
      <div className="module-foot">
        <span>
          <i className="copper-dot" aria-hidden="true" />
          峰值 · {data.chart.peakLabel}
        </span>
        <span>
          平均响应 <b>{data.chart.avgResponse}</b>
        </span>
      </div>
    </div>
  )
}

function SourcesModule({ data }: { data: PeriodData }) {
  return (
    <div className="module-content module-content--sources">
      <ModuleHeading
        module="sources"
        aside={<span className="module-badge module-badge--dark">TOP 5</span>}
      />
      <ul className="source-list">
        {data.sources.slice(0, 5).map((source, index) => (
          <SourceRow key={source.id} source={source} index={index} />
        ))}
      </ul>
      <div className="module-foot module-foot--muted">
        <span>按语义引用加权</span>
        <span>{data.rangeLabel}</span>
      </div>
    </div>
  )
}

function InsightModule({ data }: { data: PeriodData }) {
  return (
    <div className="module-content module-content--insight">
      <span className="insight-card-glow" aria-hidden="true" />
      <ModuleHeading
        module="insight"
        aside={
          <span className="score-chip">
            <span>可信度</span>
            <strong>
              <AnimatedNumber
                value={data.insight.score}
                valueKey="dashboard-insight-score"
              />
            </strong>
          </span>
        }
      />
      <div className="insight-copy">
        <span className="module-kicker">{data.insight.kicker}</span>
        <h4>{data.insight.headline}</h4>
        <p>{data.insight.summary}</p>
      </div>
      <div className="insight-tags">
        {data.insight.tags.map((tag) => (
          <span key={tag} className="insight-tag">
            {tag}
          </span>
        ))}
        <span className="insight-generated">
          <SparkIcon />
          RAG synthesis
        </span>
      </div>
      <span className="insight-watermark" aria-hidden="true">
        {String(data.insight.score).padStart(2, '0')}
      </span>
    </div>
  )
}

function ActivityModule({ data }: { data: PeriodData }) {
  return (
    <div className="module-content module-content--activity">
      <ModuleHeading
        module="activity"
        aside={
          <span className="module-live module-live--soft">
            <LiveDot />
            {data.activity.length} 条新动态
          </span>
        }
      />
      <ActivityTable rows={data.activity} />
      <div className="module-foot module-foot--activity">
        <span>每次更新会自动完成解析与切片</span>
        <span>索引健康度 99.2%</span>
      </div>
    </div>
  )
}

export function ModuleGridContent({
  module,
  data,
}: {
  module: ModuleKey
  data: PeriodData
}) {
  switch (module) {
    case 'trend':
      return <TrendModule data={data} />
    case 'sources':
      return <SourcesModule data={data} />
    case 'insight':
      return <InsightModule data={data} />
    case 'activity':
      return <ActivityModule data={data} />
  }
}

function DetailStat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function DetailHeader({
  module,
  data,
  summary,
}: {
  module: ModuleKey
  data: PeriodData
  summary?: ReactNode
}) {
  const meta = MODULE_META[module]
  const Icon = meta.icon

  return (
    <header className="detail-heading">
      <div className="detail-heading__eyebrow">
        <span className="detail-heading__icon">
          <Icon />
        </span>
        <span>{meta.eyebrow}</span>
        <span className="detail-heading__range">{data.rangeLabel}</span>
      </div>
      <div className="detail-heading__row">
        <div className="detail-heading__copy">
          <h2>{meta.title}</h2>
          <p>{meta.description}</p>
        </div>
        {summary ? <div className="detail-heading__summary">{summary}</div> : null}
      </div>
    </header>
  )
}

function DetailFooter({
  items,
}: {
  items: { label: string; value: string; note: string }[]
}) {
  return (
    <div className="detail-footer">
      {items.map((item) => (
        <div key={item.label} className="detail-footer__cell">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.note}</small>
        </div>
      ))}
    </div>
  )
}

function TrendDetail({ data }: { data: PeriodData }) {
  return (
    <div className="detail-content detail-content--trend">
      <DetailHeader
        module="trend"
        data={data}
        summary={
          <>
            <span>周期调用</span>
            <strong>{formatNumber(data.chart.total)}</strong>
            <small>
              次 <em>{data.chart.delta}</em>
            </small>
          </>
        }
      />
      <div className="detail-layout detail-layout--trend">
        <section className="detail-chart-panel">
          <div className="detail-section-head">
            <div>
              <span>FLOW OVER TIME</span>
              <h3>调用走势</h3>
            </div>
            <span className="detail-target-note">
              目标线 {formatNumber(data.chart.target)} 次
            </span>
          </div>
          <TrendChart data={data.chart} large />
          <p className="detail-trend-note">
            高峰出现在 <b>{data.chart.peakLabel}</b>，单段最高
            <b> {formatNumber(data.chart.peakValue)} 次</b>。检索与问答的节奏正在
            形成稳定的午后双峰。
          </p>
        </section>
        <aside className="detail-aside">
          <div className="detail-aside-card">
            <span className="detail-aside-card__eyebrow">PERIOD SNAPSHOT</span>
            <div className="detail-stat-list">
              <DetailStat
                label="峰值时段"
                value={data.chart.peakLabel}
                detail={`${formatNumber(data.chart.peakValue)} 次调用`}
              />
              <DetailStat
                label="平均响应"
                value={data.chart.avgResponse}
                detail="较上周期 -12.4%"
              />
              <DetailStat
                label="目标达成"
                value={`${data.chart.completion}%`}
                detail="高于计划 12 个百分点"
              />
            </div>
          </div>
          <div className="composition">
            <div className="detail-section-head">
              <div>
                <span>COMPOSITION</span>
                <h3>调用构成</h3>
              </div>
            </div>
            <div className="composition-bar" aria-hidden="true">
              {data.chart.composition.map((part) => (
                <span
                  key={part.label}
                  style={{ width: `${part.ratio}%` }}
                  data-part={part.label}
                />
              ))}
            </div>
            <div className="composition-list">
              {data.chart.composition.map((part) => (
                <div key={part.label} className="composition-row">
                  <span>
                    <i aria-hidden="true" />
                    {part.label}
                  </span>
                  <strong>{part.ratio}%</strong>
                  <small>{formatNumber(part.value)}</small>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      <DetailFooter
        items={[
          {
            label: '高频意图',
            value: '规范对照 · 竞品拆解',
            note: `占本周期问法的 28.4%`,
          },
          {
            label: '信号解读',
            value: '与产品评审同频',
            note: '检索密度峰值同步出现',
          },
          {
            label: '建议动作',
            value: '补全体验案例',
            note: `目标达成 ${data.chart.completion}%，仍有上探空间`,
          },
        ]}
      />
    </div>
  )
}

function SourcesDetail({ data }: { data: PeriodData }) {
  const topSource = data.sources[0]

  return (
    <div className="detail-content detail-content--sources">
      <DetailHeader
        module="sources"
        data={data}
        summary={
          <>
            <span>引力中心</span>
            <strong>{topSource.share}</strong>
            <small>
              引力指数 <em>{topSource.delta}</em>
            </small>
          </>
        }
      />
      <div className="detail-layout detail-layout--sources">
        <section className="detail-ranking">
          <div className="detail-section-head">
            <div>
              <span>TOP KNOWLEDGE GRAVITY</span>
              <h3>知识源引力榜</h3>
            </div>
            <span className="detail-target-note">按引用加权 · {data.rangeLabel}</span>
          </div>
          <ul className="source-list source-list--detail">
            {data.sources.map((source, index) => (
              <SourceRow
                key={source.id}
                source={source}
                index={index}
                detail
              />
            ))}
          </ul>
        </section>
        <aside className="detail-source-aside">
          <div className="gravity-card">
            <span className="detail-aside-card__eyebrow">GRAVITY MAP</span>
            <div className="gravity-orbit" aria-hidden="true">
              <span className="gravity-orbit__ring" />
              <span className="gravity-orbit__ring gravity-orbit__ring--inner" />
              <span className="gravity-orbit__core">
                <strong>{topSource.share}</strong>
                <small>引力</small>
              </span>
              <span className="gravity-orbit__dot gravity-orbit__dot--one" />
              <span className="gravity-orbit__dot gravity-orbit__dot--two" />
            </div>
            <h4>{topSource.name}</h4>
            <p>
              它是当前周期被追溯最深的知识源，与「用户研究」主题形成强连接。
            </p>
            <div className="gravity-tags">
              <span>{topSource.category}</span>
              <span>{topSource.documents} 份文档</span>
            </div>
          </div>
          <div className="detail-note-card">
            <div className="detail-section-head">
              <div>
                <span>WHY IT MATTERS</span>
                <h3>值得注意</h3>
              </div>
            </div>
            <p>
              前三名知识源贡献了本周期 61.8% 的有效引用，其中「产品体验白皮书」
              与「用户研究洞察集」的交叉引用次数提升了 24%。
            </p>
          </div>
        </aside>
      </div>
      <DetailFooter
        items={[
          {
            label: '引用集中度',
            value: '61.8%',
            note: '前三名知识源贡献',
          },
          {
            label: '关联增强',
            value: '+24%',
            note: '产品体验 × 用户研究',
          },
          {
            label: '待补全主题',
            value: '3 个',
            note: '竞品体验拆解 · 优先级高',
          },
        ]}
      />
    </div>
  )
}

function InsightDetail({ data }: { data: PeriodData }) {
  return (
    <div className="detail-content detail-content--insight">
      <span className="detail-insight-glow" aria-hidden="true" />
      <DetailHeader
        module="insight"
        data={data}
        summary={
          <>
            <span>综合可信度</span>
            <strong>{data.insight.score}</strong>
            <small>
              / 100 <em>{data.insight.scoreDelta}</em>
            </small>
          </>
        }
      />
      <div className="detail-insight-layout">
        <section className="detail-insight-main">
          <p className="detail-insight-kicker">{data.insight.kicker}</p>
          <h3>{data.insight.headline}</h3>
          <p className="detail-insight-summary">{data.insight.summary}</p>
          <div className="recommendation-list">
            {data.insight.recommendations.map((recommendation, index) => (
              <div className="recommendation" key={recommendation}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{recommendation}</p>
                <span className="recommendation__arrow" aria-hidden="true">
                  <ArrowUpRightIcon />
                </span>
              </div>
            ))}
          </div>
        </section>
        <aside className="detail-insight-aside">
          <div
            className="confidence-ring"
            style={{ '--score': data.insight.score } as CSSProperties}
            aria-hidden="true"
          >
            <div className="confidence-ring__inner">
              <strong>{data.insight.score}</strong>
              <span>综合可信度</span>
            </div>
          </div>
          <div className="confidence-caption">
            <span>较上期</span>
            <strong>{data.insight.scoreDelta}</strong>
          </div>
          <div className="insight-tags insight-tags--detail">
            {data.insight.tags.map((tag) => (
              <span key={tag} className="insight-tag">
                {tag}
              </span>
            ))}
          </div>
          <div className="highlight-grid">
            {data.insight.highlights.map((highlight) => (
              <div key={highlight.label} className="highlight-cell">
                <span>{highlight.label}</span>
                <strong>{highlight.value}</strong>
              </div>
            ))}
          </div>
          <p className="detail-insight-source">
            <SparkIcon />
            基于 {formatNumber(data.chart.total)} 次调用与 96.4% 语义覆盖生成
          </p>
        </aside>
      </div>
      <DetailFooter
        items={[
          {
            label: '下一步',
            value: '补充竞品体验拆解',
            note: '模型建议 · 高优先级',
          },
          {
            label: '关联强度',
            value: '0.87',
            note: '交互规范 × 用户研究',
          },
          {
            label: '复查节律',
            value: '7 天后',
            note: '自动追踪覆盖变化',
          },
        ]}
      />
    </div>
  )
}

function ActivityDetail({ data }: { data: PeriodData }) {
  const totalChunks = data.activity.reduce((sum, row) => sum + row.chunks, 0)

  return (
    <div className="detail-content detail-content--activity">
      <DetailHeader
        module="activity"
        data={data}
        summary={
          <>
            <span>新索引切片</span>
            <strong>{formatNumber(totalChunks)}</strong>
            <small>来自 {data.activity.length} 份文档</small>
          </>
        }
      />
      <div className="detail-layout detail-layout--activity">
        <section className="detail-activity-main">
          <div className="detail-section-head">
            <div>
              <span>KNOWLEDGE IN MOTION</span>
              <h3>最近的沉淀</h3>
            </div>
            <span className="detail-target-note">全部自动解析完成</span>
          </div>
          <ActivityTable rows={data.activity} detail />
        </section>
        <aside className="detail-activity-aside">
          <div className="detail-aside-card">
            <span className="detail-aside-card__eyebrow">INGESTION HEALTH</span>
            <div className="detail-stat-list">
              <DetailStat
                label="入库文档"
                value={`${data.activity.length} 份`}
                detail="全部来自团队工作空间"
              />
              <DetailStat
                label="平均切片"
                value={`${Math.round(totalChunks / data.activity.length)} 个`}
                detail="按语义边界自动切分"
              />
              <DetailStat
                label="解析健康度"
                value="99.2%"
                detail="较上周期 +0.6%"
              />
            </div>
          </div>
          <div className="detail-note-card">
            <div className="detail-section-head">
              <div>
                <span>SYNC STATUS</span>
                <h3>索引状态</h3>
              </div>
            </div>
            <div className="sync-steps">
              <div>
                <span className="sync-step is-done">
                  <i />
                </span>
                <p>
                  文档解析
                  <small>4 / 4 完成</small>
                </p>
              </div>
              <div>
                <span className="sync-step is-done">
                  <i />
                </span>
                <p>
                  向量化
                  <small>自动完成</small>
                </p>
              </div>
              <div>
                <span className="sync-step is-live">
                  <i />
                </span>
                <p>
                  语义索引
                  <small>持续同步中</small>
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <DetailFooter
        items={[
          {
            label: '本轮入库',
            value: `${data.activity.length} 份文档`,
            note: `${formatNumber(totalChunks)} 个语义切片`,
          },
          {
            label: '解析效率',
            value: '42 秒',
            note: '平均单文档解析时长',
          },
          {
            label: '索引健康',
            value: '99.2%',
            note: '全部向量通道正常',
          },
        ]}
      />
    </div>
  )
}

export function ModuleDetailContent({
  module,
  data,
}: {
  module: ModuleKey
  data: PeriodData
}) {
  switch (module) {
    case 'trend':
      return <TrendDetail data={data} />
    case 'sources':
      return <SourcesDetail data={data} />
    case 'insight':
      return <InsightDetail data={data} />
    case 'activity':
      return <ActivityDetail data={data} />
  }
}

export function ModuleThumbContent({
  module,
  data,
}: {
  module: ModuleKey
  data: PeriodData
}) {
  const meta = MODULE_META[module]
  const Icon = meta.icon

  return (
    <>
      <span className="module-thumb__icon">
        <Icon />
      </span>
      <span className="module-thumb__copy">
        <strong>{meta.shortTitle}</strong>
        <small>{getModuleThumbMetric(module, data)}</small>
      </span>
      <span className="module-thumb__arrow" aria-hidden="true">
        <ArrowUpRightIcon />
      </span>
    </>
  )
}
