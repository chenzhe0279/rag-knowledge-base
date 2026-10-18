import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHealth } from '../api/health'
import type {
  HealthCheck,
  HealthCheckMap,
  ServiceDefinition,
  ServiceId,
} from '../types/health'

const INITIAL_CHECK: HealthCheck = {
  phase: 'loading',
  response: null,
  error: null,
  latencyMs: null,
  checkedAt: null,
  refreshing: true,
}

function createInitialChecks(): HealthCheckMap {
  return {
    api: { ...INITIAL_CHECK },
    db: { ...INITIAL_CHECK },
    cos: { ...INITIAL_CHECK },
  }
}

/**
 * 并行管理三个健康检查。
 *
 * 每次请求都会分配递增的 requestId，只有最新一次请求允许写入状态，
 * 这样重复点击刷新或组件卸载时，旧响应不会覆盖新结果。
 */
export function useHealthChecks(services: ServiceDefinition[]) {
  const [checks, setChecks] = useState<HealthCheckMap>(createInitialChecks)
  const requestIds = useRef<Record<ServiceId, number>>({ api: 0, db: 0, cos: 0 })

  /** 只负责发起请求和写入结果，不修改“刷新中”标记。 */
  const performCheck = useCallback(async (service: ServiceDefinition) => {
    const requestId = ++requestIds.current[service.id]

    try {
      const { data, latencyMs } = await fetchHealth(service.endpoint)

      if (requestId !== requestIds.current[service.id]) {
        return
      }

      setChecks((previous) => ({
        ...previous,
        [service.id]: {
          phase: 'success',
          response: data,
          error: null,
          latencyMs,
          checkedAt: new Date(),
          refreshing: false,
        },
      }))
    } catch (error) {
      if (requestId !== requestIds.current[service.id]) {
        return
      }

      setChecks((previous) => ({
        ...previous,
        [service.id]: {
          phase: 'failure',
          response: null,
          error: error instanceof Error ? error.message : '未知错误',
          latencyMs: null,
          checkedAt: new Date(),
          refreshing: false,
        },
      }))
    }
  }, [])

  const runCheck = useCallback(
    (service: ServiceDefinition) => {
      setChecks((previous) => ({
        ...previous,
        [service.id]: {
          ...previous[service.id],
          refreshing: true,
        },
      }))
      void performCheck(service)
    },
    [performCheck],
  )

  useEffect(() => {
    const ids = requestIds.current

    // 初始状态已经是 loading/refreshing，effect 中直接发请求即可。
    // 这是挂载时与外部系统同步的合法场景，请求结果在 await 之后才写入 state。
    for (const service of services) {
      // oxlint-disable-next-line react/set-state-in-effect
      void performCheck(service)
    }

    return () => {
      // 让所有在途请求失效，避免卸载后继续写入状态。
      for (const id of Object.keys(ids) as ServiceId[]) {
        ids[id] += 1
      }
    }
  }, [services, performCheck])

  const refresh = useCallback(
    (service: ServiceDefinition) => {
      runCheck(service)
    },
    [runCheck],
  )

  const refreshAll = useCallback(() => {
    for (const service of services) {
      runCheck(service)
    }
  }, [services, runCheck])

  return { checks, refresh, refreshAll }
}
