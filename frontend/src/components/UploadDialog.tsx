import { useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { uploadDocument } from '../api/documents'
import {
  ACCEPTED_FILE_TYPES,
  ACCEPTED_FORMATS_LABEL,
  MAX_UPLOAD_SIZE_MB,
  validateUploadFile,
} from '../lib/documents'
import { formatBytes } from '../lib/format'
import type { DocumentRead } from '../types/documents'
import { AlertIcon, CloseIcon, FileTextIcon, UploadIcon } from './Icons'
import { Spinner } from './Spinner'

interface UploadDialogProps {
  onClose: () => void
  onUploaded: (document: DocumentRead) => void
}

export function UploadDialog({ onClose, onUploaded }: UploadDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const selectFile = (next: File | null) => {
    if (!next) {
      return
    }

    const message = validateUploadFile(next)
    if (message) {
      setFile(null)
      setError(message)
      return
    }

    setFile(next)
    setError(null)
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    selectFile(event.dataTransfer.files[0] ?? null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file || uploading) {
      return
    }

    setUploading(true)
    setError(null)

    try {
      const uploaded = await uploadDocument(file)
      onUploaded(uploaded)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : '文档上传失败',
      )
      setUploading(false)
    }
  }

  const requestClose = () => {
    if (!uploading) {
      onClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal upload-dialog"
      aria-labelledby="upload-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          requestClose()
        }
      }}
    >
      <form className="upload-dialog__form" onSubmit={handleSubmit}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">UPLOAD DOCUMENT</span>
            <h2 id="upload-dialog-title">上传到知识库</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            disabled={uploading}
            aria-label="关闭上传窗口"
          >
            <CloseIcon />
          </button>
        </div>

        <p className="upload-dialog__lead">
          上传后后端会自动完成解析、切分与向量化。处理中的文档可以离开页面，稍后回来查看进度。
        </p>

        <label
          className={`dropzone${dragging ? ' dropzone--active' : ''}${file ? ' dropzone--has-file' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            className="visually-hidden"
            onChange={(event) => {
              selectFile(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
            disabled={uploading}
          />
          {file ? (
            <div className="dropzone__selected">
              <span className="dropzone__file-icon">
                <FileTextIcon />
              </span>
              <span className="dropzone__file-copy">
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </span>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={(event) => {
                  event.preventDefault()
                  setFile(null)
                  inputRef.current?.click()
                }}
                disabled={uploading}
              >
                重新选择
              </button>
            </div>
          ) : (
            <div className="dropzone__empty">
              <span className="dropzone__icon">
                <UploadIcon />
              </span>
              <strong>拖拽文件到这里，或点击选择</strong>
              <span>
                支持 {ACCEPTED_FORMATS_LABEL}，单个文件不超过 {MAX_UPLOAD_SIZE_MB}{' '}
                MB
              </span>
            </div>
          )}
        </label>

        {error ? (
          <div className="inline-alert inline-alert--danger" role="alert">
            <AlertIcon className="icon" />
            <span>{error}</span>
          </div>
        ) : null}

        {uploading ? (
          <div className="upload-progress" role="status">
            <div className="upload-progress__track">
              <span />
            </div>
            <span>正在上传并写入对象存储…</span>
          </div>
        ) : null}

        <div className="modal__footer">
          <button
            type="button"
            className="button button--ghost"
            onClick={requestClose}
            disabled={uploading}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={!file || uploading}
          >
            {uploading ? <Spinner small label="上传中" /> : <UploadIcon className="icon" />}
            {uploading ? '上传中…' : '开始上传'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
