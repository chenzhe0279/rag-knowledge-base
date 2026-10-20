import type { DocumentRead, DocumentStatus } from '../types/documents'

/** 与后端 settings.upload_max_size_mb 保持一致；客户端先做一次友好校验。 */
export const MAX_UPLOAD_SIZE_MB = 50
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

/** 手动上传缩略图的限制，与后端 DocumentService 保持一致。 */
export const MAX_THUMBNAIL_SIZE_MB = 10
export const MAX_THUMBNAIL_SIZE_BYTES = MAX_THUMBNAIL_SIZE_MB * 1024 * 1024

export const THUMBNAIL_ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const

export const THUMBNAIL_ACCEPT = THUMBNAIL_ACCEPTED_EXTENSIONS.join(',')
export const THUMBNAIL_FORMATS_LABEL = 'PDF、JPG、JPEG、PNG、WebP'

/** 与后端文档名字段校验保持一致；按 Unicode 码点计数。 */
export const MAX_DOCUMENT_NAME_LENGTH = 255

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/
// eslint-disable-next-line no-control-regex -- 文件名校验必须拦截控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.md',
  '.markdown',
  '.html',
  '.htm',
] as const

export const ACCEPTED_FILE_TYPES = ACCEPTED_EXTENSIONS.join(',')

export const ACCEPTED_FORMATS_LABEL = 'PDF、DOCX、PPTX、XLSX、Markdown、HTML'

export type DocumentKind =
  | 'markdown'
  | 'pdf'
  | 'html'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'other'

export type DocumentStatusTone =
  | 'success'
  | 'danger'
  | 'info'
  | 'pending'
  | 'warning'

export interface DocumentStatusMeta {
  label: string
  tone: DocumentStatusTone
  hint: string
  processing: boolean
}

export const DOCUMENT_STATUS_META: Record<DocumentStatus, DocumentStatusMeta> = {
  uploading: {
    label: '上传中',
    tone: 'pending',
    hint: '文件已接收，等待开始解析',
    processing: true,
  },
  parsing: {
    label: '解析中',
    tone: 'info',
    hint: '正在解析文档结构并提取文本',
    processing: true,
  },
  indexing: {
    label: '向量化中',
    tone: 'info',
    hint: '正在切分文本并生成向量',
    processing: true,
  },
  ready: {
    label: '已就绪',
    tone: 'success',
    hint: '解析与向量化已完成，可用于检索',
    processing: false,
  },
  failed: {
    label: '处理失败',
    tone: 'danger',
    hint: '解析或向量化失败，可以尝试重新处理',
    processing: false,
  },
}

export function isProcessingStatus(status: DocumentStatus): boolean {
  return DOCUMENT_STATUS_META[status].processing
}

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/** 判断手动上传的缩略图源文件是不是 PDF。 */
export function isPdfThumbnailFile(file: File): boolean {
  return getFileExtension(file.name) === '.pdf'
}

/** 手动缩略图的客户端校验；内容是否合法最终仍由后端判断。 */
export function validateThumbnailFile(file: File): string | null {
  const extension = getFileExtension(file.name)

  if (
    !THUMBNAIL_ACCEPTED_EXTENSIONS.includes(
      extension as (typeof THUMBNAIL_ACCEPTED_EXTENSIONS)[number],
    )
  ) {
    return `缩略图仅支持 ${THUMBNAIL_FORMATS_LABEL} 文件`
  }

  if (file.size === 0) {
    return '缩略图文件内容为空'
  }

  if (file.size > MAX_THUMBNAIL_SIZE_BYTES) {
    return `缩略图不能超过 ${MAX_THUMBNAIL_SIZE_MB} MB`
  }

  return null
}

export interface DocumentNameParts {
  baseName: string
  extension: string
}

/** 拆分“主文件名 + 扩展名”，扩展名保留原始大小写。 */
export function splitDocumentName(name: string): DocumentNameParts {
  const dotIndex = name.lastIndexOf('.')

  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return { baseName: name, extension: '' }
  }

  return {
    baseName: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  }
}

/** 用固定扩展名拼接出新文件名，避免前端误改后缀。 */
export function buildRenamedDocumentName(
  originalName: string,
  baseName: string,
): string {
  const { extension } = splitDocumentName(originalName)
  return `${baseName.trim()}${extension}`
}

/**
 * 重命名校验：非空、长度、非法字符、首尾空白、扩展名不变。
 * 返回 `null` 表示通过，否则返回可直接展示的中文错误。
 */
export function validateRenamedDocumentName(
  originalName: string,
  baseName: string,
): string | null {
  const trimmed = baseName.trim()
  const { extension } = splitDocumentName(originalName)
  const candidate = `${trimmed}${extension}`

  if (!trimmed) {
    return '文件名不能为空'
  }

  if (trimmed === '.' || trimmed === '..') {
    return '文件名不能是 . 或 ..'
  }

  if (Array.from(candidate).length > MAX_DOCUMENT_NAME_LENGTH) {
    return `文件名不能超过 ${MAX_DOCUMENT_NAME_LENGTH} 个字符`
  }

  if (INVALID_FILENAME_CHARS.test(trimmed)) {
    return '文件名不能包含 \\ / : * ? " < > |'
  }

  if (CONTROL_CHARACTERS.test(trimmed)) {
    return '文件名不能包含控制字符'
  }

  if (trimmed.endsWith('.')) {
    return '文件名不能以句点结尾'
  }

  if (splitDocumentName(candidate).extension !== extension) {
    return '不允许修改文件扩展名'
  }

  return null
}

export function getDocumentKind(
  document: Pick<DocumentRead, 'name' | 'mime_type'>,
): DocumentKind {
  const mime = document.mime_type.toLowerCase()
  const extension = getFileExtension(document.name)

  if (mime.includes('markdown') || extension === '.md' || extension === '.markdown') {
    return 'markdown'
  }
  if (mime === 'application/pdf' || extension === '.pdf') {
    return 'pdf'
  }
  if (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    extension === '.html' ||
    extension === '.htm'
  ) {
    return 'html'
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === '.docx'
  ) {
    return 'docx'
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    extension === '.pptx'
  ) {
    return 'pptx'
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    extension === '.xlsx'
  ) {
    return 'xlsx'
  }
  return 'other'
}

export function getDocumentKindLabel(kind: DocumentKind): string {
  switch (kind) {
    case 'markdown':
      return 'MD'
    case 'pdf':
      return 'PDF'
    case 'html':
      return 'HTML'
    case 'docx':
      return 'DOCX'
    case 'pptx':
      return 'PPTX'
    case 'xlsx':
      return 'XLSX'
    default:
      return 'FILE'
  }
}

/** Office 二进制文件浏览器无法内联渲染，只能下载后本地打开。 */
export function isOfficeDocument(kind: DocumentKind): boolean {
  return kind === 'docx' || kind === 'pptx' || kind === 'xlsx'
}

export function getUnsupportedPreviewTitle(kind: DocumentKind): string {
  switch (kind) {
    case 'docx':
      return 'Word 文档不支持网页内预览'
    case 'pptx':
      return 'PowerPoint 演示文稿不支持网页内预览'
    case 'xlsx':
      return 'Excel 工作簿不支持网页内预览'
    default:
      return '该格式暂不支持在线预览'
  }
}

export function validateUploadFile(file: File): string | null {
  const extension = getFileExtension(file.name)

  if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return `仅支持 ${ACCEPTED_FORMATS_LABEL} 文件`
  }

  if (file.size === 0) {
    return '文件内容为空'
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `文件超过 ${MAX_UPLOAD_SIZE_MB} MB 上限`
  }

  return null
}
