export type PeriodKey = 'day' | 'week' | 'month'

export type DashboardView = 'overview' | 'trend' | 'insight'

export type ModuleKey = 'trend' | 'sources' | 'insight' | 'activity'

export type CardTone = 'glass' | 'coffee' | 'ink'

export interface PeriodOption {
  key: PeriodKey
  label: string
  caption: string
}

export interface Metric {
  id: string
  label: string
  value: number
  unit: string
  delta: string
  comparison: string
  spark: number[]
}

export interface ChartComposition {
  label: string
  value: number
  ratio: number
}

export interface ChartData {
  labels: string[]
  values: number[]
  target: number
  total: number
  delta: string
  completion: number
  peakLabel: string
  peakValue: number
  avgResponse: string
  composition: ChartComposition[]
}

export interface SourceItem {
  id: string
  name: string
  category: string
  documents: number
  calls: number
  delta: string
  share: number
}

export interface ActivityRow {
  id: string
  name: string
  format: 'PDF' | 'DOCX' | 'MD' | 'XLSX'
  contributor: string
  initials: string
  chunks: number
  updatedAt: string
  status: '已入索引' | '解析中' | '已更新'
}

export interface InsightData {
  kicker: string
  headline: string
  summary: string
  score: number
  scoreDelta: string
  tags: string[]
  recommendations: string[]
  highlights: { label: string; value: string }[]
}

export interface PeriodData {
  key: PeriodKey
  label: string
  rangeLabel: string
  updatedAt: string
  health: number
  healthDelta: string
  semanticCoverage: string
  metrics: Metric[]
  chart: ChartData
  sources: SourceItem[]
  insight: InsightData
  activity: ActivityRow[]
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'day', label: '日', caption: '今日' },
  { key: 'week', label: '周', caption: '本周' },
  { key: 'month', label: '月', caption: '本月' },
]

export const DEFAULT_PERIOD: PeriodKey = 'month'

export const DASHBOARD_NAV: { id: DashboardView; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'trend', label: '趋势' },
  { id: 'insight', label: '洞察' },
]

export const MODULE_ORDER: ModuleKey[] = [
  'trend',
  'sources',
  'insight',
  'activity',
]

export const DASHBOARD_DATA: Record<PeriodKey, PeriodData> = {
  day: {
    key: 'day',
    label: '今日',
    rangeLabel: '10 月 22 日 · 当日',
    updatedAt: '09:42',
    health: 96,
    healthDelta: '+2.8',
    semanticCoverage: '98.1%',
    metrics: [
      {
        id: 'assets',
        label: '知识资产',
        value: 12864,
        unit: '篇',
        delta: '+6',
        comparison: '较昨日',
        spark: [42, 48, 46, 55, 63, 69, 74, 82],
      },
      {
        id: 'retrieval',
        label: '语义检索',
        value: 3428,
        unit: '次',
        delta: '+16.2%',
        comparison: '较昨日',
        spark: [28, 42, 36, 58, 76, 64, 88, 71],
      },
      {
        id: 'answers',
        label: '智能问答',
        value: 816,
        unit: '轮',
        delta: '+11.9%',
        comparison: '较昨日',
        spark: [34, 32, 48, 44, 62, 71, 68, 86],
      },
    ],
    chart: {
      labels: ['00', '04', '08', '12', '16', '20', '现在'],
      values: [210, 320, 410, 560, 720, 680, 528],
      target: 620,
      total: 3428,
      delta: '+16.2%',
      completion: 116,
      peakLabel: '16:00 — 20:00',
      peakValue: 720,
      avgResponse: '0.38 s',
      composition: [
        { label: '语义检索', value: 2130, ratio: 62 },
        { label: '智能问答', value: 816, ratio: 24 },
        { label: '引用回溯', value: 482, ratio: 14 },
      ],
    },
    sources: [
      {
        id: 'day-source-1',
        name: '产品体验白皮书 v2',
        category: '产品设计',
        documents: 128,
        calls: 428,
        delta: '+18%',
        share: 86,
      },
      {
        id: 'day-source-2',
        name: '智能检索规范',
        category: '研发手册',
        documents: 86,
        calls: 356,
        delta: '+12%',
        share: 71,
      },
      {
        id: 'day-source-3',
        name: '用户研究洞察集',
        category: '用户研究',
        documents: 64,
        calls: 284,
        delta: '+9%',
        share: 58,
      },
      {
        id: 'day-source-4',
        name: 'Agent 评测笔记',
        category: 'AI 实践',
        documents: 42,
        calls: 219,
        delta: '+24%',
        share: 44,
      },
      {
        id: 'day-source-5',
        name: '数据治理手册',
        category: '数据平台',
        documents: 38,
        calls: 167,
        delta: '+6%',
        share: 34,
      },
      {
        id: 'day-source-6',
        name: '客服话术知识库',
        category: '服务体验',
        documents: 95,
        calls: 141,
        delta: '+3%',
        share: 28,
      },
    ],
    insight: {
      kicker: '今日洞察 · 01',
      headline: '午后三点，知识被最频繁地点亮。',
      summary:
        '今日检索高峰出现在 15:00 至 16:00，产品体验相关问法占比 31.2%。「新手引导」与「权限配置」的交叉检索明显增多，值得关注。',
      score: 95,
      scoreDelta: '+2.1',
      tags: ['午后峰值', '产品体验', '新手引导'],
      recommendations: [
        '在高频时段前预热「权限配置」的衍生问答。',
        '为产品体验白皮书补充新手引导章节。',
        '观察明日同期检索是否形成稳定峰值。',
      ],
      highlights: [
        { label: '峰值命中', value: '98.4%' },
        { label: '新增问法', value: '42 条' },
        { label: '待补答案', value: '3 条' },
      ],
    },
    activity: [
      {
        id: 'day-activity-1',
        name: '智能检索体验规范 v3',
        format: 'PDF',
        contributor: '林夏',
        initials: 'LX',
        chunks: 128,
        updatedAt: '2 分钟前',
        status: '已入索引',
      },
      {
        id: 'day-activity-2',
        name: '权限配置答疑手册',
        format: 'DOCX',
        contributor: '周屿',
        initials: 'ZY',
        chunks: 64,
        updatedAt: '18 分钟前',
        status: '已更新',
      },
      {
        id: 'day-activity-3',
        name: 'Agent 评测观察笔记',
        format: 'MD',
        contributor: '南乔',
        initials: 'NQ',
        chunks: 37,
        updatedAt: '46 分钟前',
        status: '已入索引',
      },
      {
        id: 'day-activity-4',
        name: '客户体验指标看板',
        format: 'XLSX',
        contributor: '顾言',
        initials: 'GY',
        chunks: 19,
        updatedAt: '1 小时前',
        status: '解析中',
      },
    ],
  },
  week: {
    key: 'week',
    label: '本周',
    rangeLabel: '10.16 — 10.22 · 第 43 周',
    updatedAt: '09:42',
    health: 91,
    healthDelta: '+3.6',
    semanticCoverage: '95.8%',
    metrics: [
      {
        id: 'assets',
        label: '知识资产',
        value: 12906,
        unit: '篇',
        delta: '+182',
        comparison: '较上周',
        spark: [38, 44, 52, 49, 61, 66, 71, 79],
      },
      {
        id: 'retrieval',
        label: '语义检索',
        value: 22840,
        unit: '次',
        delta: '+18.7%',
        comparison: '较上周',
        spark: [22, 38, 49, 44, 66, 58, 81, 76],
      },
      {
        id: 'answers',
        label: '智能问答',
        value: 5214,
        unit: '轮',
        delta: '+12.3%',
        comparison: '较上周',
        spark: [30, 40, 34, 55, 52, 68, 63, 82],
      },
    ],
    chart: {
      labels: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      values: [2380, 3020, 3260, 3820, 4140, 3180, 3040],
      target: 3600,
      total: 22840,
      delta: '+18.7%',
      completion: 104,
      peakLabel: '周五 · 产品讨论日',
      peakValue: 4140,
      avgResponse: '0.41 s',
      composition: [
        { label: '语义检索', value: 14160, ratio: 62 },
        { label: '智能问答', value: 5214, ratio: 23 },
        { label: '引用回溯', value: 3466, ratio: 15 },
      ],
    },
    sources: [
      {
        id: 'week-source-1',
        name: '产品体验白皮书 v2',
        category: '产品设计',
        documents: 128,
        calls: 3120,
        delta: '+18%',
        share: 84,
      },
      {
        id: 'week-source-2',
        name: '智能检索规范',
        category: '研发手册',
        documents: 86,
        calls: 2440,
        delta: '+12%',
        share: 69,
      },
      {
        id: 'week-source-3',
        name: '用户研究洞察集',
        category: '用户研究',
        documents: 64,
        calls: 1980,
        delta: '+9%',
        share: 55,
      },
      {
        id: 'week-source-4',
        name: 'Agent 评测笔记',
        category: 'AI 实践',
        documents: 42,
        calls: 1560,
        delta: '+24%',
        share: 43,
      },
      {
        id: 'week-source-5',
        name: '数据治理手册',
        category: '数据平台',
        documents: 38,
        calls: 1210,
        delta: '+6%',
        share: 32,
      },
      {
        id: 'week-source-6',
        name: '客服话术知识库',
        category: '服务体验',
        documents: 95,
        calls: 1040,
        delta: '+3%',
        share: 28,
      },
    ],
    insight: {
      kicker: '本周洞察 · 01',
      headline: '问答的理解深度，正在稳步上扬。',
      summary:
        '本周多轮问答占比提升至 27.4%，追问主要围绕「为什么」与「如何验证」。知识库已具备支撑复杂决策的语义结构，下一步可加强案例型内容。',
      score: 89,
      scoreDelta: '+3.6',
      tags: ['多轮问答', '决策链路', '案例缺口'],
      recommendations: [
        '为高频追问补充决策依据与验证方法。',
        '将 6 份项目复盘转化为可检索案例。',
        '建立每周五的产品知识同步节奏。',
      ],
      highlights: [
        { label: '追问深度', value: '2.8 轮' },
        { label: '引用覆盖', value: '91.2%' },
        { label: '案例缺口', value: '6 份' },
      ],
    },
    activity: [
      {
        id: 'week-activity-1',
        name: '产品体验白皮书 v2',
        format: 'PDF',
        contributor: '林夏',
        initials: 'LX',
        chunks: 128,
        updatedAt: '今天 08:46',
        status: '已更新',
      },
      {
        id: 'week-activity-2',
        name: '智能检索规范',
        format: 'MD',
        contributor: '周屿',
        initials: 'ZY',
        chunks: 86,
        updatedAt: '昨天 17:20',
        status: '已入索引',
      },
      {
        id: 'week-activity-3',
        name: '用户访谈摘录',
        format: 'DOCX',
        contributor: '南乔',
        initials: 'NQ',
        chunks: 92,
        updatedAt: '10 月 20 日',
        status: '已入索引',
      },
      {
        id: 'week-activity-4',
        name: '客服意图样本集',
        format: 'XLSX',
        contributor: '顾言',
        initials: 'GY',
        chunks: 64,
        updatedAt: '10 月 19 日',
        status: '解析中',
      },
    ],
  },
  month: {
    key: 'month',
    label: '本月',
    rangeLabel: '10.01 — 10.22 · 当月',
    updatedAt: '09:42',
    health: 94,
    healthDelta: '+4.2',
    semanticCoverage: '96.4%',
    metrics: [
      {
        id: 'assets',
        label: '知识资产',
        value: 13248,
        unit: '篇',
        delta: '+8.4%',
        comparison: '较上月',
        spark: [30, 38, 34, 48, 55, 52, 68, 76],
      },
      {
        id: 'retrieval',
        label: '语义检索',
        value: 98420,
        unit: '次',
        delta: '+32.8%',
        comparison: '较上月',
        spark: [26, 39, 35, 52, 61, 72, 68, 88],
      },
      {
        id: 'answers',
        label: '智能问答',
        value: 21760,
        unit: '轮',
        delta: '+27.4%',
        comparison: '较上月',
        spark: [22, 34, 46, 43, 57, 63, 78, 84],
      },
    ],
    chart: {
      labels: ['1日', '5日', '10日', '15日', '20日', '25日', '30日'],
      values: [10840, 12420, 10960, 15820, 14480, 18760, 15140],
      target: 12000,
      total: 98420,
      delta: '+32.8%',
      completion: 112,
      peakLabel: '25 日前后 · 产品评审周',
      peakValue: 18760,
      avgResponse: '0.42 s',
      composition: [
        { label: '语义检索', value: 61020, ratio: 62 },
        { label: '智能问答', value: 21760, ratio: 23 },
        { label: '引用回溯', value: 15640, ratio: 15 },
      ],
    },
    sources: [
      {
        id: 'month-source-1',
        name: '产品体验白皮书 v2',
        category: '产品设计',
        documents: 128,
        calls: 12840,
        delta: '+18%',
        share: 84,
      },
      {
        id: 'month-source-2',
        name: '智能检索规范',
        category: '研发手册',
        documents: 86,
        calls: 9740,
        delta: '+12%',
        share: 69,
      },
      {
        id: 'month-source-3',
        name: '用户研究洞察集',
        category: '用户研究',
        documents: 64,
        calls: 8120,
        delta: '+9%',
        share: 55,
      },
      {
        id: 'month-source-4',
        name: 'Agent 评测笔记',
        category: 'AI 实践',
        documents: 42,
        calls: 6420,
        delta: '+24%',
        share: 43,
      },
      {
        id: 'month-source-5',
        name: '数据治理手册',
        category: '数据平台',
        documents: 38,
        calls: 4980,
        delta: '+6%',
        share: 32,
      },
      {
        id: 'month-source-6',
        name: '客服话术知识库',
        category: '服务体验',
        documents: 95,
        calls: 4260,
        delta: '+3%',
        share: 28,
      },
    ],
    insight: {
      kicker: '本月洞察 · 01',
      headline: '知识密度，正向产品体验聚拢。',
      summary:
        '产品体验相关检索占比升至 38.6%，「交互规范」与「用户研究」的语义关联显著增强。建议补充竞品体验拆解，让决策链路更完整。',
      score: 92,
      scoreDelta: '+4.2',
      tags: ['产品体验', '用户研究', '语义关联'],
      recommendations: [
        '补充 6 份竞品体验拆解，连接决策盲区。',
        '把「交互规范」与「用户研究」合并为主题簇。',
        '将高关联问答沉淀为可复用的决策卡片。',
      ],
      highlights: [
        { label: '关联强度', value: '0.87' },
        { label: '新增主题', value: '6 个' },
        { label: '待补全', value: '3 处' },
      ],
    },
    activity: [
      {
        id: 'month-activity-1',
        name: '智能检索体验规范 v3',
        format: 'PDF',
        contributor: '林夏',
        initials: 'LX',
        chunks: 128,
        updatedAt: '2 分钟前',
        status: '已入索引',
      },
      {
        id: 'month-activity-2',
        name: '交互设计决策清单',
        format: 'DOCX',
        contributor: '周屿',
        initials: 'ZY',
        chunks: 64,
        updatedAt: '32 分钟前',
        status: '已更新',
      },
      {
        id: 'month-activity-3',
        name: 'Agent 评测观察笔记',
        format: 'MD',
        contributor: '南乔',
        initials: 'NQ',
        chunks: 37,
        updatedAt: '1 小时前',
        status: '已入索引',
      },
      {
        id: 'month-activity-4',
        name: '客户体验指标看板',
        format: 'XLSX',
        contributor: '顾言',
        initials: 'GY',
        chunks: 19,
        updatedAt: '3 小时前',
        status: '解析中',
      },
    ],
  },
}

export function formatNumber(value: number, decimals = 0) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
