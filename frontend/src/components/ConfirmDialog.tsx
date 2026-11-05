import { useState, type ReactNode } from 'react'
import { errorMessage } from '../api/http'
import { AlertIcon } from './Icons'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  /** 危险操作使用红色按钮。 */
  danger?: boolean
  onConfirm: () => Promise<void>
  onClose: () => void
}

/** 二次确认弹窗：onConfirm 失败时错误留在弹窗内，成功由调用方关闭。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  danger = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    if (busy) return
    setError(null)
    onClose()
  }

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      eyebrow="Confirm"
      size="sm"
      busy={busy}
      onClose={handleClose}
      footer={
        <>
          <button type="button" className="btn" onClick={handleClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={danger ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
            {busy ? '处理中…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        <p className="muted">{description}</p>
        {error ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={16} />
              {error}
            </span>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
