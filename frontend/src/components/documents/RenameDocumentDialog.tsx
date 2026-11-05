import { useState, type FormEvent } from 'react'
import { renameDocument } from '../../api/documents'
import { errorMessage } from '../../api/http'
import { validateDocumentName } from '../../lib/documents'
import type { DocumentRead } from '../../types/api'
import { AlertIcon } from '../Icons'
import { Modal } from '../Modal'

interface RenameDocumentDialogProps {
  document: DocumentRead
  onClose: () => void
  onRenamed: (document: DocumentRead) => void
}

/** 由父组件按需挂载（document 非空时渲染），草稿随文档重置。 */
export function RenameDocumentDialog({ document, onClose, onRenamed }: RenameDocumentDialogProps) {
  const [name, setName] = useState(document.name)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validation = validateDocumentName(name, document.name)
  const unchanged = name.trim() === document.name

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched(true)
    if (validation || unchanged) return
    setBusy(true)
    setError(null)
    try {
      onRenamed(await renameDocument(document.id, name.trim()))
    } catch (caught) {
      setError(errorMessage(caught, '重命名失败'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="重命名文档"
      eyebrow="Rename"
      description="只修改显示名称，不会触发重新索引；扩展名需要保持不变。"
      size="sm"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            form="rename-document-form"
            className="btn btn--primary"
            disabled={busy || unchanged || Boolean(validation)}
          >
            {busy ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <form id="rename-document-form" className="doc-dialog" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="rename-document-input">
            文件名
          </label>
          <input
            id="rename-document-input"
            className="input"
            value={name}
            maxLength={255}
            onChange={(event) => {
              setName(event.target.value)
              setTouched(true)
            }}
            disabled={busy}
            aria-invalid={touched && Boolean(validation)}
            autoFocus
          />
          {touched && validation ? <span className="field__error">{validation}</span> : null}
        </div>
        {error ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={16} />
              {error}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
