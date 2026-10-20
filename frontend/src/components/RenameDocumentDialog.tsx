import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { renameDocument } from '../api/documents'
import {
  buildRenamedDocumentName,
  MAX_DOCUMENT_NAME_LENGTH,
  splitDocumentName,
  validateRenamedDocumentName,
} from '../lib/documents'
import type { DocumentRead } from '../types/documents'
import { AlertIcon, CloseIcon } from './Icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import './RenameDocumentDialog.css'

interface RenameDocumentDialogProps {
  document: DocumentRead
  onClose: () => void
  onRenamed: (document: DocumentRead) => void
}

export function RenameDocumentDialog({
  document,
  onClose,
  onRenamed,
}: RenameDocumentDialogProps) {
  const { baseName, extension } = splitDocumentName(document.name)
  const [value, setValue] = useState(baseName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [])

  const trimmed = value.trim()
  const previewName = buildRenamedDocumentName(document.name, value)
  const validationError = validateRenamedDocumentName(document.name, value)
  const liveError = value !== baseName ? validationError : null
  const displayError = error ?? liveError
  const isUnchanged = trimmed === baseName.trim()
  const nameLength = Array.from(previewName).length
  const canSubmit = !saving && !isUnchanged && validationError === null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextValidationError = validateRenamedDocumentName(
      document.name,
      value,
    )
    if (nextValidationError) {
      setError(nextValidationError)
      return
    }

    if (isUnchanged) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const updated = await renameDocument(document.id, previewName)
      onRenamed(updated)
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : '重命名失败',
      )
      setSaving(false)
    }
  }

  return (
    <Modal
      labelledBy="rename-dialog-title"
      className="rename-dialog"
      closeDisabled={saving}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">RENAME DOCUMENT</span>
            <h2 id="rename-dialog-title">重命名文档</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭重命名窗口"
          >
            <CloseIcon />
          </button>
        </div>

        <p className="rename-dialog__lead">
          当前文件名：<strong>{document.name}</strong>
          <br />
          扩展名将保持不变，只修改主文件名。
        </p>

        <label className="rename-dialog__label" htmlFor="rename-document-name">
          新的文件名
        </label>
        <div className="name-editor">
          <input
            ref={inputRef}
            id="rename-document-name"
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              if (error) {
                setError(null)
              }
            }}
            disabled={saving}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(displayError)}
            aria-describedby={
              displayError ? 'rename-document-error' : 'rename-document-hint'
            }
          />
          {extension ? (
            <span className="name-editor__suffix" aria-hidden="true">
              {extension}
            </span>
          ) : null}
        </div>

        <div className="rename-dialog__meta" id="rename-document-hint">
          <span>扩展名不可修改</span>
          <span
            className={
              nameLength > MAX_DOCUMENT_NAME_LENGTH
                ? 'rename-dialog__counter is-over'
                : 'rename-dialog__counter'
            }
          >
            {nameLength} / {MAX_DOCUMENT_NAME_LENGTH}
          </span>
        </div>

        {displayError ? (
          <div
            className="inline-alert inline-alert--danger"
            id="rename-document-error"
            role="alert"
          >
            <AlertIcon className="icon" />
            <span>{displayError}</span>
          </div>
        ) : null}

        <div className="modal__footer">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={!canSubmit}
          >
            {saving ? <Spinner small label="保存中" /> : null}
            {saving ? '保存中…' : '保存新名称'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
