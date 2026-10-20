import type { HealthCheck, HealthStatus } from '../types/health'

export type StatusTone = 'success' | 'danger' | 'warning' | 'pending'

export interface StatusPresentation {
  label: string
  tone: StatusTone
  message: string
}

const STATUS_PRESENTATION: Record<
  HealthStatus,
  Pick<StatusPresentation, 'label' | 'tone' | 'message'>
> = {
  ok: {
    label: '正常',
    tone: 'success',
    message: '接口响应正常，依赖服务运行稳定。',
  },
  error: {
    label: '异常',
    tone: 'danger',
    message: '接口返回异常状态，请查看详情并排查依赖服务。',
  },
  not_configured: {
    label: '未配置',
    tone: 'warning',
    message: '相关配置尚未填写，完成配置后即可参与健康检查。',
  },
}

/** 把一次检测结果转换成卡片直接可用的文案与色调。 */
export function presentHealth(check: HealthCheck): StatusPresentation {
  if (check.phase === 'loading') {
    return {
      label: '检测中',
      tone: 'pending',
      message: '正在连接后端服务并读取健康状态…',
    }
  }

  if (check.phase === 'failure') {
    return {
      label: '连接失败',
      tone: 'danger',
      message: check.error ?? '请求失败，请确认后端服务已启动。',
    }
  }

  const response = check.response
  if (!response) {
    return {
      label: '未知',
      tone: 'warning',
      message: '接口没有返回有效的健康状态。',
    }
  }

  const presentation = STATUS_PRESENTATION[response.status]
  const detail = response.detail?.trim()

  return {
    label: presentation.label,
    tone: presentation.tone,
    message: detail || presentation.message,
  }
}
