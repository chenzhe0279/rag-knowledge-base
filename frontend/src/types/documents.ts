import type { components } from './schema'

type ApiDocumentRead = components['schemas']['DocumentRead']

/**
 * 后端文档响应模型，外加前端已接入的缩略图地址与权限字段。
 * `thumbnail_url` 为相对路径（例如 `/api/documents/{id}/thumbnail`）或完整 URL；
 * 没有缩略图时为 null，前端会自动回退到文件类型占位图。
 */
export type DocumentRead = Omit<
  ApiDocumentRead,
  'permission_tags' | 'created_by'
> & {
  thumbnail_url?: string | null
  permission_tags?: string[]
  created_by?: string | null
}

export type DocumentStatus = ApiDocumentRead['status']

export type DocumentListResponse = Omit<
  components['schemas']['DocumentListResponse'],
  'items'
> & {
  items: DocumentRead[]
}

export type DocumentChunkRead = components['schemas']['DocumentChunkRead']
export type DocumentChunkDetail = components['schemas']['DocumentChunkDetail']
export type DocumentChunkListResponse =
  components['schemas']['DocumentChunkListResponse']
export type DocumentChunkStats = components['schemas']['DocumentChunkStats']
