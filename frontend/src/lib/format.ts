const EMPTY = '—'

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return EMPTY
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const shortFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  return date ? dateTimeFormatter.format(date) : EMPTY
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  return date ? dateFormatter.format(date) : EMPTY
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  return date ? timeFormatter.format(date) : EMPTY
}

export function formatShortDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  return date ? shortFormatter.format(date) : EMPTY
}

/** 相对时间：一周内显示“x 分钟前”，更久显示日期。 */
export function formatRelative(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY
  const diff = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(date)
}

/** 毫秒 → 秒（2 位小数）；≥ 60s 显示分钟。 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return EMPTY
  if (ms >= 60_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return `${minutes} 分 ${seconds} 秒`
  }
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const from = toDate(start)
  const to = toDate(end)
  if (!from || !to) return EMPTY
  return formatLatency(to.getTime() - from.getTime())
}

export function formatScore(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  return value.toFixed(digits)
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  return `${(value * 100).toFixed(digits)}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return EMPTY
  return id.length > length ? id.slice(0, length) : id
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return EMPTY
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash
}

export function percentOf(done: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

export function initials(name: string | null | undefined): string {
  const text = (name ?? '').trim()
  if (!text) return '?'
  return Array.from(text)[0].toUpperCase()
}

/** 逗号/顿号/空白分隔的标签字符串 → 去重数组。 */
export function parseTags(input: string): string[] {
  const tags = input
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  return Array.from(new Set(tags))
}
