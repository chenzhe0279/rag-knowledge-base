import { useEffect, useId, useRef, type ReactNode } from 'react'
import { CloseIcon } from './Icons'
import './Modal.css'

interface ModalProps {
  open: boolean
  title: ReactNode
  eyebrow?: string
  description?: ReactNode
  onClose: () => void
  /** 提交中时禁止 Esc / 遮罩 / 关闭按钮关闭。 */
  busy?: boolean
  size?: 'sm' | 'md' | 'lg'
  footer?: ReactNode
  children: ReactNode
}

/** 基于原生 <dialog>：浏览器负责焦点陷阱与 Esc；关闭时焦点回到触发元素。 */
export function Modal({
  open,
  title,
  eyebrow,
  description,
  onClose,
  busy = false,
  size = 'md',
  footer,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()
  const busyRef = useRef(busy)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    busyRef.current = busy
    onCloseRef.current = onClose
  }, [busy, onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) return
    // 调用方常在关闭时直接卸载弹窗，浏览器来不及还原焦点，这里自行记录并还原
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    function handleCancel(event: Event) {
      event.preventDefault()
      if (!busyRef.current) onCloseRef.current()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [])

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    // 点击 dialog 本身（而非内部内容）即点击遮罩
    if (event.target === event.currentTarget && !busy) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className={`modal modal--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={handleBackdropClick}
    >
      {open ? (
        <div className="modal__surface">
          <header className="modal__header">
            <div className="modal__heading">
              {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
              <h2 id={titleId} className="modal__title">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="modal__desc">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="关闭"
              onClick={onClose}
              disabled={busy}
            >
              <CloseIcon />
            </button>
          </header>
          <div className="modal__body">{children}</div>
          {footer ? <footer className="modal__footer">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  )
}
