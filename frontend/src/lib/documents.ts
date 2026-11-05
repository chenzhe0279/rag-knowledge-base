import type {
  DocumentRead,
  DocumentStatus,
  IngestionTask,
  IngestionTaskStatus,
} from '../types/api'

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'accent' | 'pending'

export const DOCUMENT_STATUS_META: Record<
  DocumentStatus,
  { label: string; tone: Tone; live: boolean }
> = {
  uploading: { label: '上传中', tone: 'info', live: true },
  parsing: { label: '解析中', tone: 'warning', live: true },
  indexing: { label: '向量化中', tone: 'accent', live: true },
  ready: { label: '已就绪', tone: 'success', live: false },
  failed: { label: '处理失败', tone: 'danger', live: false },
}

export const DOCUMENT_STATUS_OPTIONS: { value: DocumentStatus | null; label: string }[] = [
  { value: null, label: '全部' },
  { value: 'ready', label: '已就绪' },
  { value: 'parsing', label: '解析中' },
  { value: 'indexing', label: '向量化中' },
  { value: 'uploading', label: '上传中' },
  { value: 'failed', label: '处理失败' },
]

export const TASK_STATUS_META: Record<
  IngestionTaskStatus,
  { label: string; tone: Tone; live: boolean }
> = {
  pending: { label: '排队中', tone: 'pending', live: true },
  running: { label: '处理中', tone: 'accent', live: true },
  success: { label: '已完成', tone: 'success', live: false },
  failed: { label: '失败', tone: 'danger', live: false },
}

export const TASK_TYPE_LABEL: Record<IngestionTask['task_type'], string> = {
  ingest: '首次入库',
  reindex: '增量重建',
}

export function isTaskActive(task: IngestionTask | null | undefined): boolean {
  return task?.status === 'pending' || task?.status === 'running'
}

export function isDocumentProcessing(document: DocumentRead): boolean {
  return (
    document.status === 'uploading' ||
    document.status === 'parsing' ||
    document.status === 'indexing' ||
    isTaskActive(document.latest_task)
  )
}

export type FileKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'markdown' | 'html' | 'other'

const MIME_KIND: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  pptx: 'PPTX',
  xlsx: 'XLSX',
  markdown: 'MD',
  html: 'HTML',
  other: 'FILE',
}

export function fileKindFromMime(mime: string | null | undefined): FileKind {
  if (!mime) return 'other'
  return MIME_KIND[mime.split(';')[0].trim().toLowerCase()] ?? 'other'
}

export function fileKindFromName(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'pptx':
      return 'pptx'
    case 'xlsx':
      return 'xlsx'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'html':
    case 'htm':
      return 'html'
    default:
      return 'other'
  }
}

/** 检索过滤器可选的 MIME，与后端上传白名单一致。 */
export const FILTERABLE_MIME_TYPES: { value: string; label: string }[] = [
  { value: 'application/pdf', label: 'PDF' },
  {
    value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word',
  },
  {
    value: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PPT',
  },
  {
    value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel',
  },
  { value: 'text/markdown', label: 'Markdown' },
  { value: 'text/html', label: 'HTML' },
]

export const UPLOAD_ACCEPT = '.pdf,.docx,.pptx,.xlsx,.md,.markdown,.html,.htm'
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const UPLOAD_FORMATS_TEXT = 'PDF、Word、PPT、Excel、Markdown、HTML'

export function validateUploadFile(file: File): string | null {
  if (fileKindFromName(file.name) === 'other') {
    return `不支持的文件格式，请选择 ${UPLOAD_FORMATS_TEXT}`
  }
  if (file.size === 0) return '文件为空，请重新选择'
  if (file.size > UPLOAD_MAX_BYTES) return '文件超过 50MB 上限'
  return null
}

/** 与 Python PurePath.suffix 一致：取最后一个点之后的部分（区分大小写）。 */
function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const index = base.lastIndexOf('.')
  return index > 0 && index < base.length - 1 ? base.slice(index) : ''
}

/** 与后端 DocumentService.rename 校验保持一致的前端友好提示。 */
export function validateDocumentName(name: string, originalName: string): string | null {
  const value = name.trim()
  if (!value) return '文件名不能为空'
  if (value.length > 255) return '文件名不能超过 255 个字符'
  if (value === '.' || value === '..') return '文件名不能是 . 或 ..'
  if (/[\\/:*?"<>|]/.test(value)) return '文件名不能包含 \\ / : * ? " < > |'
  if (Array.from(value).some((char) => char.charCodeAt(0) < 32)) return '文件名不能包含控制字符'
  if (value.endsWith('.')) return '文件名不能以句点或空格结尾'
  if (extensionOf(value) !== extensionOf(originalName)) return '不允许修改文件扩展名'
  return null
}

export function permissionScopeText(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return '公开'
  return tags.join('、')
}

export const PERMISSION_TAG_PRESETS = ['public', 'hr', 'finance', 'engineering', 'it', 'legal']
