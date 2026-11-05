import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from '../Icons'
import { ToastContext, type ToastContextValue, type ToastItem, type ToastTone } from './ToastContext'
import './Toast.css'

const DURATION: Record<ToastTone, number> = {
  success: 3200,
  info: 3600,
  error: 5200,
}

const MAX_TOASTS = 4

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++
      setToasts((items) => [...items, { id, tone, message }].slice(-MAX_TOASTS))
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION[tone]),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message) => show(message, 'success'),
      error: (message) => show(message, 'error'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast"
            data-tone={toast.tone}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="toast__icon">
              {toast.tone === 'success' ? (
                <CheckCircleIcon size={17} />
              ) : toast.tone === 'error' ? (
                <AlertIcon size={17} />
              ) : (
                <InfoIcon size={17} />
              )}
            </span>
            <p className="toast__text">{toast.message}</p>
            <button
              type="button"
              className="toast__close"
              aria-label="关闭提示"
              onClick={() => dismiss(toast.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
