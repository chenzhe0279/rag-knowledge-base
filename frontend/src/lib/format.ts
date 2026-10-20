const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatTime(date: Date): string {
  return TIME_FORMATTER.format(date)
}

export function formatDateTime(value: string | Date): string {
  const date = toDate(value)
  return date ? DATE_TIME_FORMATTER.format(date) : '—'
}

export function formatDate(value: string | Date): string {
  const date = toDate(value)
  return date ? DATE_FORMATTER.format(date) : '—'
}

export function formatLatency(latencyMs: number | null): string | null {
  if (latencyMs === null) {
    return null
  }

  return latencyMs < 1000
    ? `${Math.max(latencyMs, 0)} ms`
    : `${(latencyMs / 1000).toFixed(2)} s`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}
