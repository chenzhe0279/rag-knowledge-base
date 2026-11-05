import { useCallback, useEffect, useRef, useState } from 'react'
import { listDocuments } from '../../api/documents'
import { fetchHealth } from '../../api/health'
import { errorMessage, isAbortError } from '../../api/http'
import { usePolling } from '../../hooks/usePolling'
import type { DocumentRead, HealthStatus } from '../../types/api'

const RECENT_SIZE = 6
const POLL_INTERVAL = 30_000

export interface LiveDocuments {
  total: number
  ready: number
  failed: number
  /** 按创建时间倒序的最新文档。 */
  recent: DocumentRead[]
}

export type HealthLevel = 'checking' | 'ok' | 'degraded' | 'down'

export interface LiveHealth {
  level: HealthLevel
  api: HealthStatus | null
  db: HealthStatus | null
  checkedAt: Date | null
}

function healthLevel(api: HealthStatus | null, db: HealthStatus | null, apiFailed: boolean): HealthLevel {
  if (apiFailed || (api && api.status !== 'ok')) return 'down'
  if (!api) return 'checking'
  if (!db || db.status !== 'ok') return 'degraded'
  return 'ok'
}

/**
 * 看板里唯一的真实数据来源：复用 /api/documents 与 /api/health。
 * 后端没有看板聚合接口，因此这里分别请求后在前端汇总。
 */
export function useDashboardLive() {
  const [documents, setDocuments] = useState<LiveDocuments | null>(null)
  const [documentsError, setDocumentsError] = useState<string | null>(null)
  const [health, setHealth] = useState<LiveHealth>({
    level: 'checking',
    api: null,
    db: null,
    checkedAt: null,
  })
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const { signal } = controller

    const documentsTask = Promise.all([
      listDocuments({ page: 1, pageSize: RECENT_SIZE }, signal),
      listDocuments({ page: 1, pageSize: 1, status: 'ready' }, signal),
      listDocuments({ page: 1, pageSize: 1, status: 'failed' }, signal),
    ])
      .then(([latest, ready, failed]) => {
        setDocuments({
          total: latest.total,
          ready: ready.total,
          failed: failed.total,
          recent: latest.items,
        })
        setDocumentsError(null)
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) return
        setDocumentsError(errorMessage(caught, '文档数据加载失败'))
      })

    const healthTask = Promise.allSettled([fetchHealth('api', signal), fetchHealth('db', signal)]).then(
      ([api, db]) => {
        if (signal.aborted) return
        const apiValue = api.status === 'fulfilled' ? api.value : null
        const dbValue = db.status === 'fulfilled' ? db.value : null
        setHealth({
          level: healthLevel(apiValue, dbValue, api.status === 'rejected'),
          api: apiValue,
          db: dbValue,
          checkedAt: new Date(),
        })
      },
    )

    await Promise.all([documentsTask, healthTask])
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.abort()
    }
  }, [load])

  usePolling(() => void load(), POLL_INTERVAL, true)

  return { documents, documentsError, health, reload: load }
}
