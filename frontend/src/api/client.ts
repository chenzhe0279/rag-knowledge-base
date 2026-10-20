import createClient from 'openapi-fetch'
import { API_BASE_URL } from '../config'
import type { paths } from '../types/schema'

/**
 * 基于 `npm run gen:api` 生成的 OpenAPI 类型创建的类型安全客户端。
 * baseUrl 留空时请求同源 `/api`，开发环境走 Vite 代理。
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
})
