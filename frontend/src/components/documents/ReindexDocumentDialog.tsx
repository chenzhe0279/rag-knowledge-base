import { useState, type FormEvent } from 'react'
import { reindexDocument } from '../../api/documents'
import { errorMessage } from '../../api/http'
import {
  FILE_KIND_LABEL,
  fileKindFromMime,
  fileKindFromName,
  UPLOAD_ACCEPT,
  validateUploadFile,
} from '../../lib/documents'
import { formatBytes } from '../../lib/format'
import type { DocumentRead } from '../../types/api'
import { AlertIcon, InfoIcon } from '../Icons'
import { Modal } from '../Modal'
import { DropZone } from './DropZone'

interface ReindexDocumentDialogProps {
  document: DocumentRead
  /** 文档处理中或有活动任务时禁止提交。 */
  locked: boolean
  onClose: () => void
  onSubmitted: (document: DocumentRead) => void
}

/** 由父组件按需挂载，关闭即卸载，文件选择随之清空。 */
export function ReindexDocumentDialog({
  document,
  locked,
  onClose,
  onSubmitted,
}: ReindexDocumentDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kind = fileKindFromMime(document.mime_type)

  function validate(next: File): string | null {
    const invalid = validateUploadFile(next)
    if (invalid) return invalid
    // 后端按 MIME 校验，这里按扩展名做一次前置提示
    if (fileKindFromName(next.name) !== kind) {
      return `新版本必须与原文档类型一致（${FILE_KIND_LABEL[kind]}）`
    }
    return null
  }

  function handleSelect(next: File | null) {
    setFile(next)
    setError(next ? validate(next) : null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || locked) return
    const invalid = validate(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSubmitted(await reindexDocument(document.id, file))
    } catch (caught) {
      setError(errorMessage(caught, '提交重新索引失败'))
      setBusy(false)
    }
  }

  const invalid = file ? validate(file) : null

  return (
    <Modal
      open
      title="上传新版本"
      eyebrow="Incremental reindex"
      description="用新文件替换原文档内容，Worker 会按 chunk 哈希比对，只对变化的文本块重新向量化。"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            form="reindex-document-form"
            className="btn btn--primary"
            disabled={!file || Boolean(invalid) || busy || locked}
          >
            {busy ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
            {busy ? '正在提交…' : '开始重建'}
          </button>
        </>
      }
    >
      <form id="reindex-document-form" className="doc-dialog" onSubmit={handleSubmit}>
        <dl className="facts doc-dialog__facts">
          <div>
            <dt>当前文档</dt>
            <dd title={document.name}>{document.name}</dd>
          </div>
          <div>
            <dt>MIME</dt>
            <dd className="mono">{document.mime_type}</dd>
          </div>
          <div>
            <dt>大小</dt>
            <dd className="num">{formatBytes(document.size)}</dd>
          </div>
          <div>
            <dt>内容版本</dt>
            <dd className="num">
              v{document.version} → v{document.version + 1}
            </dd>
          </div>
        </dl>

        {locked ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={16} />
              文档处理中，请等待完成或失败后再重新索引
            </span>
          </div>
        ) : null}

        <DropZone
          file={file}
          onSelect={handleSelect}
          accept={UPLOAD_ACCEPT}
          disabled={busy || locked}
          label="选择新版本文件"
          hint={`仅支持 ${FILE_KIND_LABEL[kind]}，与原文档类型一致，单个文件不超过 50MB`}
        />

        <div className="inline-note">
          <InfoIcon size={15} />
          <p>
            文件类型（MIME）必须与原文档一致；内容完全相同会被拒绝。
            <br />
            只重建变化的文本块，未变化部分直接复用；重建成功后版本号 +1，失败则保持原版本。
          </p>
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
