import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument } from '../api/documents'
import { isProcessingStatus } from '../lib/documents'
import type { DocumentRead } from '../types/documents'

export function useDocumentDetail(documentId: string) {
  const [document, setDocument] = useState<DocumentRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current

      if (!silent) {
        setLoading(true)
      }

      try {
        const next = await getDocument(documentId)

        if (requestId.current !== id) {
          return
        }

        setDocument(next)
        setError(null)
      } catch (loadError) {
        if (requestId.current !== id) {
          return
        }

        setError(
          loadError instanceof Error ? loadError.message : '加载文档详情失败',
        )
      } finally {
        if (requestId.current === id) {
          setLoading(false)
        }
      }
    },
    [documentId],
  )

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load()

    return () => {
      requestId.current += 1
    }
  }, [load])

  const refresh = useCallback(() => {
    void load(true)
  }, [load])

  const status = document?.status

  useEffect(() => {
    if (!status || !isProcessingStatus(status)) {
      return
    }

    const timer = window.setInterval(() => {
      void load(true)
    }, 2500)

    return () => window.clearInterval(timer)
  }, [status, load])

  return { document, loading, error, refresh }
}
