import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  renameDocument,
  resolveApiAssetUrl,
  uploadDocumentThumbnail,
} from '../api/documents'
import {
  buildRenamedDocumentName,
  getDocumentKind,
  getDocumentKindLabel,
  isPdfThumbnailFile,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_THUMBNAIL_SIZE_MB,
  splitDocumentName,
  THUMBNAIL_ACCEPT,
  THUMBNAIL_FORMATS_LABEL,
  validateRenamedDocumentName,
  validateThumbnailFile,
} from '../lib/documents'
import { formatBytes } from '../lib/format'
import type { DocumentRead } from '../types/documents'
import { AlertIcon, CloseIcon, UploadIcon } from './Icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import './RenameDocumentDialog.css'

interface RenameDocumentDialogProps {
  document: DocumentRead
  onClose: () => void
  onSaved: (document: DocumentRead) => void
  onDocumentUpdated?: (document: DocumentRead) => void
}

export function RenameDocumentDialog({
  document,
  onClose,
  onSaved,
  onDocumentUpdated,
}: RenameDocumentDialogProps) {
  const { baseName, extension } = splitDocumentName(document.name)
  const [value, setValue] = useState(baseName)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(
    null,
  )
  const [thumbnailError, setThumbnailError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [])

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    },
    [],
  )

  const trimmed = value.trim()
  const previewName = buildRenamedDocumentName(document.name, value)
  const validationError = validateRenamedDocumentName(document.name, value)
  const liveError = value !== baseName ? validationError : null
  const displayError = error ?? liveError
  const isUnchanged = trimmed === baseName.trim()
  const hasNewThumbnail = thumbnailFile !== null
  const nameLength = Array.from(previewName).length
  const canSubmit =
    !saving && validationError === null && (!isUnchanged || hasNewThumbnail)

  const selectThumbnail = (file: File | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setThumbnailPreviewUrl(null)

    if (!file) {
      setThumbnailFile(null)
      setThumbnailError(null)
      return
    }

    const validation = validateThumbnailFile(file)
    if (validation) {
      setThumbnailFile(null)
      setThumbnailError(validation)
      return
    }

    setThumbnailFile(file)
    setThumbnailError(null)

    if (!isPdfThumbnailFile(file)) {
      const previewUrl = URL.createObjectURL(file)
      objectUrlRef.current = previewUrl
      setThumbnailPreviewUrl(previewUrl)
    }
  }

  const handleThumbnailChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectThumbnail(event.target.files?.[0] ?? null)
    event.target.value = ''
  }

  const clearThumbnail = () => {
    selectThumbnail(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextNameError = validateRenamedDocumentName(document.name, value)
    if (nextNameError) {
      setError(nextNameError)
      return
    }

    if (thumbnailFile) {
      const nextThumbnailError = validateThumbnailFile(thumbnailFile)
      if (nextThumbnailError) {
        setThumbnailError(nextThumbnailError)
        return
      }
    }

    if (isUnchanged && !thumbnailFile) {
      return
    }

    setSaving(true)
    setError(null)
    setThumbnailError(null)

    let updated = document

    if (thumbnailFile) {
      try {
        updated = await uploadDocumentThumbnail(document.id, thumbnailFile)
        onDocumentUpdated?.(updated)
      } catch (thumbnailUploadError) {
        setError(
          `缩略图上传失败：${
            thumbnailUploadError instanceof Error
              ? thumbnailUploadError.message
              : '请稍后重试'
          }`,
        )
        setSaving(false)
        return
      }
    }

    if (!isUnchanged) {
      try {
        updated = await renameDocument(document.id, previewName)
      } catch (renameError) {
        setError(
          `${
            thumbnailFile ? '缩略图已更新，但' : ''
          }文件名修改失败：${
            renameError instanceof Error ? renameError.message : '请稍后重试'
          }`,
        )
        setSaving(false)
        return
      }
    }

    onSaved(updated)
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
            <span className="modal__eyebrow">EDIT DOCUMENT</span>
            <h2 id="rename-dialog-title">编辑文档信息</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭编辑窗口"
          >
            <CloseIcon />
          </button>
        </div>

        <p className="rename-dialog__lead">
          当前文件名：<strong>{document.name}</strong>
          <br />
          修改主文件名，也可以同时替换首页缩略图。扩展名不会改变。
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

        <div className="rename-thumbnail">
          <span className="rename-dialog__label">
            文档缩略图 <small>可选</small>
          </span>
          <div className="rename-thumbnail__row">
            <div className="rename-thumbnail__preview">
              {thumbnailPreviewUrl ? (
                <img src={thumbnailPreviewUrl} alt="新缩略图预览" />
              ) : thumbnailFile ? (
                <span className="rename-thumbnail__pdf">PDF</span>
              ) : (
                <CurrentThumbnailPreview
                  key={`${document.id}-${document.updated_at}`}
                  document={document}
                />
              )}
            </div>

            <div className="rename-thumbnail__copy">
              <strong>
                {thumbnailFile ? thumbnailFile.name : '使用当前缩略图'}
              </strong>
              <span>
                {thumbnailFile
                  ? formatBytes(thumbnailFile.size)
                  : `支持 ${THUMBNAIL_FORMATS_LABEL}，最大 ${MAX_THUMBNAIL_SIZE_MB} MB`}
              </span>
              <div className="rename-thumbnail__actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  <UploadIcon className="icon" />
                  {thumbnailFile ? '重新选择' : '上传缩略图'}
                </button>
                {thumbnailFile ? (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={clearThumbnail}
                    disabled={saving}
                  >
                    取消选择
                  </button>
                ) : null}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={THUMBNAIL_ACCEPT}
              className="visually-hidden"
              onChange={handleThumbnailChange}
              disabled={saving}
            />
          </div>

          {thumbnailFile && isPdfThumbnailFile(thumbnailFile) ? (
            <p className="rename-thumbnail__hint">
              PDF 会自动取第一页作为缩略图。
            </p>
          ) : null}

          {thumbnailError ? (
            <div
              className="inline-alert inline-alert--danger"
              role="alert"
              id="rename-thumbnail-error"
            >
              <AlertIcon className="icon" />
              <span>{thumbnailError}</span>
            </div>
          ) : null}
        </div>

        {displayError ? (
          <div
            className="inline-alert inline-alert--danger rename-dialog__error"
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
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CurrentThumbnailPreview({ document }: { document: DocumentRead }) {
  const [failed, setFailed] = useState(false)
  const kind = getDocumentKind(document)
  const label = getDocumentKindLabel(kind)
  const thumbnailUrl = document.thumbnail_url

  if (thumbnailUrl && !failed) {
    return (
      <img
        src={resolveApiAssetUrl(thumbnailUrl)}
        alt="当前缩略图"
        onError={() => setFailed(true)}
      />
    )
  }

  return <span className="rename-thumbnail__glyph">{label}</span>
}
