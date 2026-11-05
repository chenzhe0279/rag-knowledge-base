import { useState, type FormEvent } from 'react'
import { uploadDocument } from '../../api/documents'
import { errorMessage } from '../../api/http'
import {
  UPLOAD_ACCEPT,
  UPLOAD_FORMATS_TEXT,
  validateUploadFile,
} from '../../lib/documents'
import type { DocumentRead } from '../../types/api'
import { AlertIcon } from '../Icons'
import { Modal } from '../Modal'
import { TagEditor } from '../TagEditor'
import { DropZone } from './DropZone'

interface UploadDocumentDialogProps {
  open: boolean
  onClose: () => void
  onUploaded: (document: DocumentRead) => void
}

export function UploadDocumentDialog({ open, onClose, onUploaded }: UploadDocumentDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setFile(null)
    setTags([])
    setError(null)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  function handleSelect(next: File | null) {
    setFile(next)
    setError(next ? validateUploadFile(next) : null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
    const invalid = validateUploadFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const document = await uploadDocument(file, tags)
      reset()
      onUploaded(document)
    } catch (caught) {
      setError(errorMessage(caught, '上传失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  const invalid = file ? validateUploadFile(file) : null

  return (
    <Modal
      open={open}
      title="上传文档"
      eyebrow="Upload"
      description="上传后会自动进入解析、切分、向量化流水线；相同内容的文件会直接复用已有记录。"
      onClose={handleClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={handleClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            form="upload-document-form"
            className="btn btn--primary"
            disabled={!file || Boolean(invalid) || busy}
          >
            {busy ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
            {busy ? '正在上传…' : '开始上传'}
          </button>
        </>
      }
    >
      <form id="upload-document-form" className="doc-dialog" onSubmit={handleSubmit}>
        <DropZone
          file={file}
          onSelect={handleSelect}
          accept={UPLOAD_ACCEPT}
          disabled={busy}
          hint={`支持 ${UPLOAD_FORMATS_TEXT}，单个文件不超过 50MB`}
        />
        <TagEditor label="可见范围（权限标签）" value={tags} onChange={setTags} disabled={busy} />
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
