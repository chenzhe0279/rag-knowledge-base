/**
 * 数据看板演示数据（DEMO DATA）。
 *
 * 后端目前没有看板聚合接口，本文件中的所有数字、知识域、知识源和洞察文案
 * 仅用于视觉演示，不代表真实业务数据，也不会发送到后端。
 *
 * 看板中的真实数据只有两类，由 DashboardPage 直接读取现有接口：
 * - 文档数量 / 最近沉淀的文档：GET /api/documents
 * - 服务健康状态：GET /api/health、/api/health/db
 */

export type PeriodKey = 'day' | 'week' | 'month'

export const PERIODS: { key: PeriodKey; label: string; caption: string }[] = [
  { key: 'day', label: '日', caption: '今日' },
  { key: 'week', label: '周', caption: '近 7 天' },
  { key: 'month', label: '月', caption: '近 30 天' },
]

export interface DemoMetric {
  key: 'queries' | 'hitRate' | 'latency' | 'citation'
  label: string
  value: number
  digits: number
  unit: string
  /** 变化描述，例如 “+12.4%”。 */
  delta: string
  direction: 'up' | 'down'
  /** 该变化是否为正向（耗时下降也算正向）。 */
  positive: boolean
  hint: string
  spark: number[]
}

export interface PulsePoint {
  label: string
  queries: number
  /** 检索命中率，百分比。 */
  hitRate: number
}

export interface DomainTrend {
  label: string
  value: number
  /** 环比变化百分比。 */
  change: number
}

export interface DemoInsight {
  tone: 'success' | 'warning' | 'danger' | 'info'
  title: string
  body: string
  metric: string
}

export interface DemoSource {
  name: string
  domain: string
  hits: number
  /** 在全部引用中的占比，0–1。 */
  share: number
}

export interface DemoAiInsight {
  headline: string
  body: string
  suggestions: string[]
}

export interface PeriodData {
  metrics: DemoMetric[]
  pulse: PulsePoint[]
  domains: DomainTrend[]
  insights: DemoInsight[]
  sources: DemoSource[]
  ai: DemoAiInsight
}

export const DEMO_DATA: Record<PeriodKey, PeriodData> = {
  day: {
    metrics: [
      {
        key: 'queries',
        label: '问答次数',
        value: 1284,
        digits: 0,
        unit: '次',
        delta: '+12.4%',
        direction: 'up',
        positive: true,
        hint: '较昨日同期',
        spark: [42, 38, 51, 64, 88, 132, 158, 146, 171, 162, 139, 93],
      },
      {
        key: 'hitRate',
        label: '检索命中率',
        value: 92.6,
        digits: 1,
        unit: '%',
        delta: '+1.8pt',
        direction: 'up',
        positive: true,
        hint: 'Top-5 召回含正确片段',
        spark: [89.1, 90.4, 90.2, 91.3, 91.8, 92.4, 92.1, 93.2, 92.9, 93.4, 92.8, 92.6],
      },
      {
        key: 'latency',
        label: '平均响应',
        value: 1.42,
        digits: 2,
        unit: 's',
        delta: '-0.18s',
        direction: 'down',
        positive: true,
        hint: '首 token 0.61s',
        spark: [1.71, 1.66, 1.62, 1.58, 1.55, 1.52, 1.49, 1.51, 1.46, 1.44, 1.43, 1.42],
      },
      {
        key: 'citation',
        label: '引用覆盖率',
        value: 88.3,
        digits: 1,
        unit: '%',
        delta: '-0.6pt',
        direction: 'down',
        positive: false,
        hint: '回答附带可追溯引用',
        spark: [89.6, 89.2, 89.4, 88.9, 89.1, 88.7, 88.8, 88.4, 88.6, 88.2, 88.5, 88.3],
      },
    ],
    pulse: [
      { label: '00', queries: 42, hitRate: 89.1 },
      { label: '02', queries: 38, hitRate: 90.4 },
      { label: '04', queries: 51, hitRate: 90.2 },
      { label: '06', queries: 64, hitRate: 91.3 },
      { label: '08', queries: 88, hitRate: 91.8 },
      { label: '10', queries: 132, hitRate: 92.4 },
      { label: '12', queries: 158, hitRate: 92.1 },
      { label: '14', queries: 146, hitRate: 93.2 },
      { label: '16', queries: 171, hitRate: 92.9 },
      { label: '18', queries: 162, hitRate: 93.4 },
      { label: '20', queries: 139, hitRate: 92.8 },
      { label: '22', queries: 93, hitRate: 92.6 },
    ],
    domains: [
      { label: '人力制度', value: 312, change: 18.2 },
      { label: '工程规范', value: 276, change: 9.4 },
      { label: 'IT 支持', value: 241, change: 22.7 },
      { label: '财务流程', value: 198, change: -4.1 },
      { label: '产品资料', value: 157, change: 6.3 },
      { label: '法务合规', value: 100, change: -1.8 },
    ],
    insights: [
      {
        tone: 'success',
        title: '午后问答高峰平稳承接',
        body: '14:00–18:00 问答量占全天 38%，平均响应仍保持在 1.5s 以内，未出现限流。',
        metric: '峰值 171 次 / 2h',
      },
      {
        tone: 'warning',
        title: '财务流程问题拒答偏多',
        body: '报销与预算类问题中有 7 次触发拒答，相关制度文档可能已过期，建议补充 2026 版细则。',
        metric: '拒答 7 次',
      },
      {
        tone: 'info',
        title: 'IT 支持检索量快速上升',
        body: 'VPN 与账号权限相关问题集中出现，可考虑把常见操作整理成独立 FAQ 文档。',
        metric: '+22.7%',
      },
    ],
    sources: [
      { name: '员工手册 2026 版', domain: '人力制度', hits: 186, share: 0.21 },
      { name: '后端服务开发规范', domain: '工程规范', hits: 143, share: 0.16 },
      { name: 'IT 自助服务指南', domain: 'IT 支持', hits: 128, share: 0.14 },
      { name: '差旅与报销制度', domain: '财务流程', hits: 97, share: 0.11 },
      { name: '产品发布流程说明', domain: '产品资料', hits: 72, share: 0.08 },
    ],
    ai: {
      headline: '今天的知识需求集中在「入职」与「权限申请」。',
      body: '新员工相关问题在上午集中出现，多数可以被员工手册与 IT 自助指南覆盖；但涉及跨部门审批的提问，引用往往只命中单一文档，回答完整度偏低。',
      suggestions: [
        '把审批流程图整理为 Markdown 文档后重新入库',
        '为「财务流程」文档补充 finance 权限标签',
        '对拒答问题发起一轮评测，确认是否为召回缺失',
      ],
    },
  },
  week: {
    metrics: [
      {
        key: 'queries',
        label: '问答次数',
        value: 8436,
        digits: 0,
        unit: '次',
        delta: '+8.1%',
        direction: 'up',
        positive: true,
        hint: '较上周',
        spark: [1106, 1248, 1312, 1286, 1374, 1052, 1058],
      },
      {
        key: 'hitRate',
        label: '检索命中率',
        value: 91.9,
        digits: 1,
        unit: '%',
        delta: '+0.9pt',
        direction: 'up',
        positive: true,
        hint: 'Top-5 召回含正确片段',
        spark: [91.2, 91.5, 91.4, 92.1, 92.3, 92.0, 91.9],
      },
      {
        key: 'latency',
        label: '平均响应',
        value: 1.51,
        digits: 2,
        unit: 's',
        delta: '-0.09s',
        direction: 'down',
        positive: true,
        hint: '首 token 0.66s',
        spark: [1.63, 1.6, 1.57, 1.55, 1.52, 1.49, 1.51],
      },
      {
        key: 'citation',
        label: '引用覆盖率',
        value: 89.1,
        digits: 1,
        unit: '%',
        delta: '+0.4pt',
        direction: 'up',
        positive: true,
        hint: '回答附带可追溯引用',
        spark: [88.5, 88.9, 88.7, 89.3, 89.4, 89.0, 89.1],
      },
    ],
    pulse: [
      { label: '周一', queries: 1106, hitRate: 91.2 },
      { label: '周二', queries: 1248, hitRate: 91.5 },
      { label: '周三', queries: 1312, hitRate: 91.4 },
      { label: '周四', queries: 1286, hitRate: 92.1 },
      { label: '周五', queries: 1374, hitRate: 92.3 },
      { label: '周六', queries: 1052, hitRate: 92.0 },
      { label: '周日', queries: 1058, hitRate: 91.9 },
    ],
    domains: [
      { label: '工程规范', value: 1984, change: 11.6 },
      { label: '人力制度', value: 1872, change: 3.2 },
      { label: 'IT 支持', value: 1520, change: 14.9 },
      { label: '产品资料', value: 1196, change: 7.7 },
      { label: '财务流程', value: 1108, change: -2.4 },
      { label: '法务合规', value: 756, change: 5.1 },
    ],
    insights: [
      {
        tone: 'success',
        title: '工作日问答量稳定增长',
        body: '周一至周五问答量逐日上升，周五达到本周峰值，检索命中率同步提升到 92.3%。',
        metric: '峰值 1,374 次',
      },
      {
        tone: 'danger',
        title: '3 份文档入库失败未处理',
        body: '本周有扫描版 PDF 解析失败，相关知识暂不可检索，建议在文档库中重试或重新上传可识别文本的版本。',
        metric: '待处理 3 份',
      },
      {
        tone: 'info',
        title: '工程规范被频繁引用',
        body: '代码评审与发布流程相关问题增多，后端开发规范成为本周引用最多的知识源之一。',
        metric: '+11.6%',
      },
      {
        tone: 'warning',
        title: '周末命中率小幅回落',
        body: '周末提问更偏向开放式问题，Agent 改写次数增加，可在评测集中补充同类样本。',
        metric: '-0.4pt',
      },
    ],
    sources: [
      { name: '后端服务开发规范', domain: '工程规范', hits: 1032, share: 0.18 },
      { name: '员工手册 2026 版', domain: '人力制度', hits: 968, share: 0.17 },
      { name: 'IT 自助服务指南', domain: 'IT 支持', hits: 804, share: 0.14 },
      { name: '产品发布流程说明', domain: '产品资料', hits: 611, share: 0.11 },
      { name: '差旅与报销制度', domain: '财务流程', hits: 548, share: 0.1 },
    ],
    ai: {
      headline: '本周知识库的「工程化」属性在增强。',
      body: '工程规范与产品资料的检索量合计增长近一成，说明研发团队开始把知识库作为日常查询入口；同时失败文档拉低了部分领域的召回，修复后命中率仍有上升空间。',
      suggestions: [
        '优先重试本周入库失败的文档',
        '为高频问题补充评测样本，跟踪命中率变化',
        '拆分超长规范文档，降低单个 chunk 的信息密度',
      ],
    },
  },
  month: {
    metrics: [
      {
        key: 'queries',
        label: '问答次数',
        value: 34720,
        digits: 0,
        unit: '次',
        delta: '+21.3%',
        direction: 'up',
        positive: true,
        hint: '较上月',
        spark: [2840, 3120, 3310, 3260, 3480, 3590, 3720, 3810, 3760, 3830],
      },
      {
        key: 'hitRate',
        label: '检索命中率',
        value: 91.4,
        digits: 1,
        unit: '%',
        delta: '+2.6pt',
        direction: 'up',
        positive: true,
        hint: 'Top-5 召回含正确片段',
        spark: [88.6, 89.2, 89.8, 90.1, 90.6, 90.9, 91.2, 91.5, 91.6, 91.4],
      },
      {
        key: 'latency',
        label: '平均响应',
        value: 1.58,
        digits: 2,
        unit: 's',
        delta: '+0.04s',
        direction: 'up',
        positive: false,
        hint: '首 token 0.70s',
        spark: [1.52, 1.54, 1.53, 1.56, 1.57, 1.6, 1.59, 1.61, 1.58, 1.58],
      },
      {
        key: 'citation',
        label: '引用覆盖率',
        value: 88.7,
        digits: 1,
        unit: '%',
        delta: '+1.2pt',
        direction: 'up',
        positive: true,
        hint: '回答附带可追溯引用',
        spark: [87.3, 87.6, 87.9, 88.1, 88.2, 88.5, 88.4, 88.8, 88.9, 88.7],
      },
    ],
    pulse: [
      { label: '1日', queries: 2840, hitRate: 88.6 },
      { label: '4日', queries: 3120, hitRate: 89.2 },
      { label: '7日', queries: 3310, hitRate: 89.8 },
      { label: '10日', queries: 3260, hitRate: 90.1 },
      { label: '13日', queries: 3480, hitRate: 90.6 },
      { label: '16日', queries: 3590, hitRate: 90.9 },
      { label: '19日', queries: 3720, hitRate: 91.2 },
      { label: '22日', queries: 3810, hitRate: 91.5 },
      { label: '25日', queries: 3760, hitRate: 91.6 },
      { label: '28日', queries: 3830, hitRate: 91.4 },
    ],
    domains: [
      { label: '人力制度', value: 7860, change: 16.4 },
      { label: '工程规范', value: 7420, change: 28.9 },
      { label: 'IT 支持', value: 6180, change: 19.2 },
      { label: '产品资料', value: 5010, change: 24.6 },
      { label: '财务流程', value: 4870, change: 8.8 },
      { label: '法务合规', value: 3380, change: 12.1 },
    ],
    insights: [
      {
        tone: 'success',
        title: '命中率连续四周提升',
        body: '启用混合检索与重排后，Top-5 召回命中率从 88.6% 稳步提升到 91.4%，拒答率同步下降。',
        metric: '+2.6pt',
      },
      {
        tone: 'warning',
        title: '响应耗时轻微上升',
        body: '问答量增长 21% 的同时，平均响应增加 0.04s，主要来自 Agent 多轮检索，可评估是否收紧改写轮数。',
        metric: '+0.04s',
      },
      {
        tone: 'info',
        title: '工程规范成为增长最快的知识域',
        body: '研发团队的问答量本月增长近三成，建议为工程规范建立独立的评测集，持续跟踪回答质量。',
        metric: '+28.9%',
      },
    ],
    sources: [
      { name: '员工手册 2026 版', domain: '人力制度', hits: 4210, share: 0.17 },
      { name: '后端服务开发规范', domain: '工程规范', hits: 3980, share: 0.16 },
      { name: 'IT 自助服务指南', domain: 'IT 支持', hits: 3215, share: 0.13 },
      { name: '产品发布流程说明', domain: '产品资料', hits: 2580, share: 0.1 },
      { name: '合同审批与用印规范', domain: '法务合规', hits: 1960, share: 0.08 },
    ],
    ai: {
      headline: '这个月，知识库从「查制度」走向了「查做法」。',
      body: '人力制度仍是最大的知识域，但工程规范与产品资料的增速更快，提问也更具体。下一步的重点是让长文档切得更细、引用更准，并用评测持续验证命中率提升是否带来回答质量提升。',
      suggestions: [
        '为工程规范建立独立评测集',
        '复核 Agent 多轮检索的平均轮数',
        '清理半年未被引用的过期文档',
      ],
    },
  },
}

/** 看板工作台的模块定义。 */
export type ModuleId = 'pulse' | 'domains' | 'insights' | 'sources' | 'ai' | 'recent'

export const MODULES: { id: ModuleId; title: string; eyebrow: string; demo: boolean }[] = [
  { id: 'pulse', title: '知识脉搏', eyebrow: 'Knowledge Pulse', demo: true },
  { id: 'domains', title: '知识域趋势', eyebrow: 'Trends', demo: true },
  { id: 'insights', title: '洞察', eyebrow: 'Insights', demo: true },
  { id: 'sources', title: '榜首知识源', eyebrow: 'Top Sources', demo: true },
  { id: 'ai', title: 'AI 洞察', eyebrow: 'AI Brief', demo: true },
  { id: 'recent', title: '最近沉淀', eyebrow: 'Recently Added', demo: false },
]
