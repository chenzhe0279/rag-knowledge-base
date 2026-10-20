import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  children: ReactNode
  labelledBy: string
  className?: string
  closeDisabled?: boolean
  onClose: () => void
}

/**
 * 原生 <dialog> 封装：自带焦点陷阱与 Esc 关闭语义，
 * 同时提供点击遮罩关闭的统一行为。
 */
export function Modal({
  children,
  labelledBy,
  className = '',
  closeDisabled = false,
  onClose,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    if (!dialog.open) {
      dialog.showModal()
    }

    return () => {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={`modal ${className}`.trim()}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) {
          onClose()
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !closeDisabled) {
          onClose()
        }
      }}
    >
      {children}
    </dialog>
  )
}
