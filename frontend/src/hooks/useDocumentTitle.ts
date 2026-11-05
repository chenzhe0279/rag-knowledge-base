import { useEffect } from 'react'

const SUFFIX = 'RAG Knowledge Base'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX
  }, [title])
}
