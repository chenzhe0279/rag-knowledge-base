/**
 * 轻量 History 路由：应用只有少量页面，不引入 react-router。
 * Vite 开发服务器与 preview 默认会把未知路径回退到 index.html。
 */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'dashboard' }
  | { name: 'documents' }
  | { name: 'document'; id: string }
  | { name: 'chat'; conversationId: string | null }
  | { name: 'evaluations' }
  | { name: 'access' }
  | { name: 'status' }
  | { name: 'not-found' }

export type RouteName = Route['name']

const NAVIGATE_EVENT = 'rag-kb-navigate'

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/dashboard') return { name: 'dashboard' }
  if (path === '/documents') return { name: 'documents' }
  const documentMatch = /^\/documents\/([^/]+)$/.exec(path)
  if (documentMatch) return { name: 'document', id: decodeURIComponent(documentMatch[1]) }
  if (path === '/chat') return { name: 'chat', conversationId: null }
  const chatMatch = /^\/chat\/([^/]+)$/.exec(path)
  if (chatMatch) return { name: 'chat', conversationId: decodeURIComponent(chatMatch[1]) }
  if (path === '/evaluations') return { name: 'evaluations' }
  if (path === '/access') return { name: 'access' }
  if (path === '/status') return { name: 'status' }
  return { name: 'not-found' }
}

export const paths = {
  dashboard: () => '/',
  documents: () => '/documents',
  document: (id: string) => `/documents/${encodeURIComponent(id)}`,
  chat: (conversationId?: string | null) =>
    conversationId ? `/chat/${encodeURIComponent(conversationId)}` : '/chat',
  evaluations: () => '/evaluations',
  access: () => '/access',
  status: () => '/status',
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const current = window.location.pathname + window.location.search
  if (current === to) return
  if (options.replace) {
    window.history.replaceState(null, '', to)
  } else {
    window.history.pushState(null, '', to)
    window.scrollTo({ top: 0 })
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  window.addEventListener(NAVIGATE_EVENT, callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener(NAVIGATE_EVENT, callback)
  }
}

function getPathname() {
  return window.location.pathname
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname)
}
