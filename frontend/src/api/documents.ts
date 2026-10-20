import { apiClient } from './client'
import { API_BASE_URL } from '../config'
import type {
  DocumentChunkDetail,
  DocumentChunkListResponse,
  DocumentListResponse,
  DocumentRead,
  DocumentStatus,
} from '../types/documents'

export class DocumentsApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DocumentsApiError'
    this.status = status
  }
}

export interface DocumentListQuery {
  page: number
  pageSize: number
  status: DocumentStatus | null
}

function fallbackMessage(status?: number): string {
  if (status === 404) {
    return '资源不存在或已被删除'
  }
  if (status === 422) {
    return '请求参数不合法'
  }
  if (status === 503) {
    return '依赖服务暂不可用'
  }
  return status ? `请求失败（HTTP ${status}）` : '请求失败'
}

/** 兼容后端的业务错误 `{code, message}` 与 FastAPI 校验错误 `{detail}`。 */
export function extractApiErrorMessage(
  payload: unknown,
  fallback = '请求失败',
): string {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const record = payload as Record<string, unknown>

  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message
  }

  if (typeof record.detail === 'string' && record.detail.trim()) {
    return record.detail
  }

  if (Array.isArray(record.detail)) {
    const messages = record.detail.flatMap((item) => {
      if (
        item &&
        typeof item === 'object' &&
        'msg' in item &&
        typeof item.msg === 'string'
      ) {
        return [item.msg]
      }
      return []
    })

    if (messages.length > 0) {
      return messages.join('；')
    }
  }

  return fallback
}

interface ApiResult<T> {
  data?: T
  error?: unknown
  response: Response
}

function unwrap<T>(result: ApiResult<T>): T {
  if (result.response.ok && result.data !== undefined) {
    return result.data
  }

  throw new DocumentsApiError(
    extractApiErrorMessage(
      result.error,
      fallbackMessage(result.response.status),
    ),
    result.response.status,
  )
}

async function request<T>(task: Promise<ApiResult<T>>): Promise<T> {
  try {
    return unwrap(await task)
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      throw error
    }
    throw new DocumentsApiError('无法连接后端服务，请确认服务已启动')
  }
}

async function requestVoid(task: Promise<ApiResult<unknown>>): Promise<void> {
  try {
    const result = await task
    if (!result.response.ok) {
      throw new DocumentsApiError(
        extractApiErrorMessage(
          result.error,
          fallbackMessage(result.response.status),
        ),
        result.response.status,
      )
    }
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      throw error
    }
    throw new DocumentsApiError('无法连接后端服务，请确认服务已启动')
  }
}

export function listDocuments(query: DocumentListQuery): Promise<DocumentListResponse> {
  return request(
    apiClient.GET('/api/documents', {
      params: {
        query: {
          page: query.page,
          page_size: query.pageSize,
          status: query.status,
        },
      },
    }),
  )
}

export function getDocument(documentId: string): Promise<DocumentRead> {
  return request(
    apiClient.GET('/api/documents/{document_id}', {
      params: { path: { document_id: documentId } },
    }),
  )
}

export function deleteDocument(documentId: string): Promise<void> {
  return requestVoid(
    apiClient.DELETE('/api/documents/{document_id}', {
      params: { path: { document_id: documentId } },
    }),
  )
}

export function retryDocument(documentId: string): Promise<DocumentRead> {
  return request(
    apiClient.POST('/api/documents/{document_id}/retry', {
      params: { path: { document_id: documentId } },
    }),
  )
}

export function listDocumentChunks(
  documentId: string,
  page: number,
  pageSize: number,
): Promise<DocumentChunkListResponse> {
  return request(
    apiClient.GET('/api/documents/{document_id}/chunks', {
      params: {
        path: { document_id: documentId },
        query: { page, page_size: pageSize },
      },
    }),
  )
}

export function getDocumentChunk(
  documentId: string,
  chunkId: string,
): Promise<DocumentChunkDetail> {
  return request(
    apiClient.GET('/api/documents/{document_id}/chunks/{chunk_id}', {
      params: {
        path: { document_id: documentId, chunk_id: chunkId },
      },
    }),
  )
}

/** 原始文件地址：download=0 尽量内联预览，download=1 强制下载。 */
export function getDocumentFileUrl(
  documentId: string,
  options: { download?: boolean } = {},
): string {
  const download = options.download ? 1 : 0
  return `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}/file?download=${download}`
}

/** 文档首页缩略图地址；cacheKey 用于文档更新后绕过浏览器缓存。 */
export function getDocumentThumbnailUrl(
  documentId: string,
  cacheKey?: string,
): string {
  const suffix = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : ''
  return `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}/thumbnail${suffix}`
}

/** 后端返回的相对资源路径统一补上 API 根地址。 */
export function resolveApiAssetUrl(url: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url
  }

  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

/** Markdown 原文需要拉取后由 react-markdown 渲染，不能直接用 iframe。 */
export async function fetchMarkdownText(documentId: string): Promise<string> {
  let response: Response

  try {
    response = await fetch(getDocumentFileUrl(documentId), {
      headers: { Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.8' },
      cache: 'no-store',
    })
  } catch {
    throw new DocumentsApiError('无法读取文档内容，请确认后端服务已启动')
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    throw new DocumentsApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  return response.text()
}

/** 重命名文档：扩展名由前端固定传入，最终校验仍以后端为准。 */
export async function renameDocument(
  documentId: string,
  name: string,
): Promise<DocumentRead> {
  let response: Response

  try {
    response = await fetch(
      `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      },
    )
  } catch {
    throw new DocumentsApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new DocumentsApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as DocumentRead).id !== 'string' ||
    typeof (payload as DocumentRead).name !== 'string'
  ) {
    throw new DocumentsApiError('重命名接口返回的数据结构不符合预期')
  }

  return payload as DocumentRead
}

/** 手动上传/替换文档缩略图；后端会转成 WebP 并返回最新文档。 */
export async function uploadDocumentThumbnail(
  documentId: string,
  file: File,
): Promise<DocumentRead> {
  const formData = new FormData()
  formData.append('file', file)

  let response: Response
  try {
    response = await fetch(
      `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}/thumbnail`,
      {
        method: 'PUT',
        headers: { Accept: 'application/json' },
        body: formData,
      },
    )
  } catch {
    throw new DocumentsApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new DocumentsApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as DocumentRead).id !== 'string'
  ) {
    throw new DocumentsApiError('缩略图上传接口返回的数据结构不符合预期')
  }

  return payload as DocumentRead
}

export async function uploadDocument(file: File): Promise<DocumentRead> {
  const formData = new FormData()
  formData.append('file', file)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/documents`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    })
  } catch {
    throw new DocumentsApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new DocumentsApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as DocumentRead).id !== 'string'
  ) {
    throw new DocumentsApiError('上传接口返回的数据结构不符合预期')
  }

  return payload as DocumentRead
}
