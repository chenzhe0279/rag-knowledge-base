import type { QueryRoute, QueryRouteValue } from '../types/chat'

export type QueryRouteTone = 'neutral' | 'copper' | 'rose' | 'amber' | 'fusion'

export interface QueryRouteMeta {
  label: string
  caption: string
  description: string
  tone: QueryRouteTone
}

export const QUERY_ROUTE_META: Record<QueryRouteValue, QueryRouteMeta> = {
  original: {
    label: '原始查询',
    caption: 'ORIGINAL',
    description: '保留问题原貌，直接将用户问题送入向量检索。',
    tone: 'neutral',
  },
  rewrite: {
    label: '查询改写',
    caption: 'REWRITE',
    description: '把口语化、依赖上下文的问题补全为独立完整的检索 Query。',
    tone: 'copper',
  },
  hyde: {
    label: 'HyDE 假设文档',
    caption: 'HYDE',
    description: '先生成一段假设性答案，再用这段答案的语义去检索知识库。',
    tone: 'rose',
  },
  multi_query: {
    label: '多路查询',
    caption: 'MULTI-QUERY',
    description: '从多个角度拆解问题并多路召回，同一个文本块会按 RRF 分去重合并。',
    tone: 'amber',
  },
  rewrite_multi_query: {
    label: '改写 + 多路查询',
    caption: 'REWRITE → MULTI',
    description:
      '先把口语化或依赖上下文的问题改写为完整问题，再基于改写结果拆成多条子查询，按 RRF 合并多路召回。',
    tone: 'fusion',
  },
}

export const QUERY_ROUTE_STEPS: { key: QueryRouteValue; label: string }[] = [
  { key: 'original', label: '原始' },
  { key: 'rewrite', label: '改写' },
  { key: 'hyde', label: 'HyDE' },
  { key: 'multi_query', label: '多路' },
  { key: 'rewrite_multi_query', label: '改写+多路' },
]

export function getRouteQuery(route: QueryRoute): string {
  if (route.route === 'hyde') {
    return route.hyde_answer ?? route.query
  }
  if (route.route === 'rewrite' || route.route === 'rewrite_multi_query') {
    return route.rewritten_query ?? route.query
  }
  return route.query
}
