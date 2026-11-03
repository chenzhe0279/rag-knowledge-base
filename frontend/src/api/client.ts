import createClient from 'openapi-fetch'
import { API_BASE_URL } from '../config'
import { getAuthToken, notifyAuthExpired } from '../lib/authSession'
import type { paths } from '../types/schema'

/**
 * 基于 `npm run gen:api` 生成的 OpenAPI 类型创建的类型安全客户端。
 * baseUrl 留空时请求同源 `/api`，开发环境走 Vite 代理。
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
})

apiClient.use({
  onRequest({ request }) {
    const token = getAuthToken()
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`)
    }
    return request
  },
  onResponse({ response }) {
    if (response.status === 401) {
      notifyAuthExpired()
    }
    return response
  },
})
