import type { ComponentType, SVGProps } from 'react'
import type { CardTone, ModuleKey, PeriodData } from './dashboardData'
import { formatCompact } from './dashboardData'
import { ClockIcon, LayersIcon, PulseIcon, SparkIcon } from './icons'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface ModuleMeta {
  title: string
  shortTitle: string
  eyebrow: string
  description: string
  tone: CardTone
  icon: IconComponent
}

export const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  trend: {
    title: '知识调用趋势',
    shortTitle: '趋势',
    eyebrow: 'RETRIEVAL SIGNAL',
    description:
      '从检索、引用到对话，观察知识在团队中的流动轨迹，以及每一次提问留下的微光。',
    tone: 'glass',
    icon: PulseIcon,
  },
  sources: {
    title: '高活跃知识源',
    shortTitle: '热源',
    eyebrow: 'KNOWLEDGE GRAVITY',
    description:
      '被反复检索、引用与讨论的知识源，正在成为这张知识网络里最亮的引力中心。',
    tone: 'coffee',
    icon: LayersIcon,
  },
  insight: {
    title: 'AI 洞察',
    shortTitle: '洞察',
    eyebrow: 'MODEL SYNTHESIS',
    description:
      '模型从语义关联、检索密度与问答深度中提炼出的下一步知识行动建议。',
    tone: 'ink',
    icon: SparkIcon,
  },
  activity: {
    title: '最近沉淀',
    shortTitle: '沉淀',
    eyebrow: 'FRESH KNOWLEDGE',
    description:
      '刚刚被贡献、更新或重新索引的知识，正安静地汇入整座知识库。',
    tone: 'glass',
    icon: ClockIcon,
  },
}

export function getModuleThumbMetric(module: ModuleKey, data: PeriodData) {
  switch (module) {
    case 'trend':
      return `${formatCompact(data.chart.total)} 次调用`
    case 'sources':
      return `${data.sources.length} 个热源`
    case 'insight':
      return `可信度 ${data.insight.score}`
    case 'activity':
      return `${data.activity.length} 条新动态`
  }
}
