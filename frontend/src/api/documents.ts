import { API_BASE_URL } from '../config'
import { getAuthToken } from '../auth/authSession'
import type {
  DocumentChunkDetail,
  DocumentChunkPage,
  DocumentRead,
  DocumentStatus,
  Page,
} from '../types/api'
import { apiUrl, rawRequest, request } from './http'

export function listDocuments(
  params: { page: number; pageSize: number; status?: DocumentStatus | null },
  signal?: AbortSignal,
) {
  return request<Page<DocumentRead>>('/documents', {
    query: { page: params.page, page_size: params.pageSize, status: params.status },
    signal,
  })
}

export function getDocument(documentId: string, signal?: AbortSignal) {
  return request<DocumentRead>(`/documents/${documentId}`, { signal })
}

export function uploadDocument(file: File, permissionTags: string[]) {
  const form = new FormData()
  form.append('file', file)
  // 后端要求 JSON 数组字符串；空数组表示公开
  form.append('permission_tags', JSON.stringify(permissionTags))
  return request<DocumentRead>('/documents', { method: 'POST', form })
}

export function renameDocument(documentId: string, name: string) {
  return request<DocumentRead>(`/documents/${documentId}`, { method: 'PATCH', json: { name } })
}

export function deleteDocument(documentId: string) {
  return request<void>(`/documents/${documentId}`, { method: 'DELETE' })
}

export function retryDocument(documentId: string) {
  return request<DocumentRead>(`/documents/${documentId}/retry`, { method: 'POST' })
}

export function reindexDocument(documentId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<DocumentRead>(`/documents/${documentId}/reindex`, { method: 'POST', form })
}

export function updateDocumentPermissionTags(documentId: string, permissionTags: string[]) {
  return request<DocumentRead>(`/documents/${documentId}/permission-tags`, {
    method: 'PATCH',
    json: { permission_tags: permissionTags },
  })
}

export function uploadDocumentThumbnail(documentId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<DocumentRead>(`/documents/${documentId}/thumbnail`, { method: 'PUT', form })
}

export function listDocumentChunks(
  documentId: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
) {
  return request<DocumentChunkPage>(`/documents/${documentId}/chunks`, {
    query: { page, page_size: pageSize },
    signal,
  })
}

export function getDocumentChunk(documentId: string, chunkId: string, signal?: AbortSignal) {
  return request<DocumentChunkDetail>(`/documents/${documentId}/chunks/${chunkId}`, { signal })
}

/** 读取原文文本（Markdown 预览用），走 Authorization header。 */
export async function fetchDocumentText(documentId: string, signal?: AbortSignal) {
  const response = await rawRequest(`/documents/${documentId}/file`, {
    query: { download: 0 },
    signal,
  })
  return response.text()
}

/** iframe / 新窗口无法携带 header，使用 ?token= 查询参数。 */
export function getDocumentFileUrl(documentId: string, options: { download?: boolean } = {}) {
  const params = new URLSearchParams({ download: options.download ? '1' : '0' })
  const token = getAuthToken()
  if (token) params.set('token', token)
  return `${apiUrl(`/documents/${documentId}/file`)}?${params.toString()}`
}

/** 后端返回的 thumbnail_url 为 `/api/...` 相对路径；独立部署时补上 API 根地址。 */
export function resolveThumbnailUrl(document: DocumentRead): string | null {
  if (!document.thumbnail_url) return null
  // 用 updated_at 作为缓存破坏参数，缩略图更新后立即可见
  const version = encodeURIComponent(document.updated_at)
  return `${API_BASE_URL}${document.thumbnail_url}?v=${version}`
}
