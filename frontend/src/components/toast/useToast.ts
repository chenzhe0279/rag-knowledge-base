import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from './ToastContext'

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用')
  return context
}
