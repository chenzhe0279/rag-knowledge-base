/**
 * 运行时配置。
 *
 * 开发环境下 VITE_API_BASE_URL 留空即可，请求会走同源 `/api`，
 * 再由 Vite 开发服务器代理到 FastAPI（见 vite.config.ts）。
 * 部署到独立域名时，可通过构建期环境变量指定后端地址。
 */
const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim()

/** 后端 API 根地址（末尾不带 `/`）；为空表示使用同源代理。 */
export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, '')

/** FastAPI Swagger 文档地址，方便从首页直接跳转调试。 */
export const API_DOCS_URL = `${API_BASE_URL || 'http://127.0.0.1:8000'}/docs`
