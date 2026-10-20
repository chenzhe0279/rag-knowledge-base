import { useCallback, useEffect, useRef, useState } from 'react'
import { listDocuments } from '../api/documents'
import { isProcessingStatus } from '../lib/documents'
import type { DocumentRead, DocumentStatus } from '../types/documents'

export const DOCUMENT_PAGE_SIZE = 10

export function useDocumentLibrary() {
  const [documents, setDocuments] = useState<DocumentRead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<DocumentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current

      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const data = await listDocuments({
          page,
          pageSize: DOCUMENT_PAGE_SIZE,
          status,
        })

        if (requestId.current !== id) {
          return
        }

        setDocuments(data.items)
        setTotal(data.total)
      } catch (loadError) {
        if (requestId.current !== id) {
          return
        }

        if (!silent) {
          setDocuments([])
          setTotal(0)
        }
        setError(
          loadError instanceof Error ? loadError.message : '加载文档列表失败',
        )
      } finally {
        if (requestId.current === id) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [page, status],
  )

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load()

    return () => {
      requestId.current += 1
    }
  }, [load])

  const hasProcessing = documents.some((document) =>
    isProcessingStatus(document.status),
  )

  useEffect(() => {
    if (!hasProcessing) {
      return
    }

    const timer = window.setInterval(() => {
      void load(true)
    }, 3000)

    return () => window.clearInterval(timer)
  }, [hasProcessing, load])

  const changeStatus = useCallback((next: DocumentStatus | null) => {
    setStatus(next)
    setPage(1)
  }, [])

  const refresh = useCallback(() => {
    void load(true)
  }, [load])

  const replaceDocument = useCallback((updated: DocumentRead) => {
    setDocuments((previous) =>
      previous.map((document) =>
        document.id === updated.id
          ? {
              ...document,
              ...updated,
              thumbnail_url:
                updated.thumbnail_url !== undefined
                  ? updated.thumbnail_url
                  : document.thumbnail_url,
            }
          : document,
      ),
    )
  }, [])

  return {
    documents,
    total,
    page,
    pageSize: DOCUMENT_PAGE_SIZE,
    status,
    loading,
    refreshing,
    error,
    setPage,
    setStatus: changeStatus,
    refresh,
    replaceDocument,
  }
}
