import { useState, type FormEvent } from 'react'
import { uploadDocumentThumbnail } from '../../api/documents'
import { errorMessage } from '../../api/http'
import type { DocumentRead } from '../../types/api'
import { AlertIcon } from '../Icons'
import { Modal } from '../Modal'
import { DropZone } from './DropZone'

const THUMBNAIL_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const THUMBNAIL_SUFFIXES = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']
const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024

/** 与后端 upload_thumbnail 的后缀 / 大小校验保持一致。 */
function validateThumbnail(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!THUMBNAIL_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    return '缩略图仅支持 PDF、JPG、JPEG、PNG、WebP'
  }
  if (file.size === 0) return '缩略图文件为空'
  if (file.size > THUMBNAIL_MAX_BYTES) return '缩略图不能超过 10 MB'
  return null
}

interface ThumbnailDialogProps {
  document: DocumentRead
  onClose: () => void
  onSaved: (document: DocumentRead) => void
}

export function ThumbnailDialog({ document, onClose, onSaved }: ThumbnailDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invalid = file ? validateThumbnail(file) : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || invalid) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await uploadDocumentThumbnail(document.id, file))
    } catch (caught) {
      setError(errorMessage(caught, '缩略图上传失败'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="更换封面"
      eyebrow="Thumbnail"
      description="上传图片或 PDF（取首页），后端会统一裁切压缩为 WebP 封面。"
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
            form="thumbnail-form"
            className="btn btn--primary"
            disabled={!file || Boolean(invalid) || busy}
          >
            {busy ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
            {busy ? '正在处理…' : '上传封面'}
          </button>
        </>
      }
    >
      <form id="thumbnail-form" className="doc-dialog" onSubmit={handleSubmit}>
        <DropZone
          file={file}
          onSelect={(next) => {
            setFile(next)
            setError(null)
          }}
          accept={THUMBNAIL_ACCEPT}
          disabled={busy}
          label="选择封面文件"
          hint="支持 PDF、JPG、PNG、WebP，不超过 10MB"
        />
        {invalid || error ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={16} />
              {invalid ?? error}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
