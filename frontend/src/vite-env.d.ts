/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 根地址；留空表示使用同源 /api（开发环境由 Vite 代理）。 */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
