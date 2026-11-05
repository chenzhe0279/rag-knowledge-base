import { useState, type FormEvent } from 'react'
import { updateDocumentPermissionTags } from '../../api/documents'
import { errorMessage } from '../../api/http'
import { permissionScopeText } from '../../lib/documents'
import type { DocumentRead } from '../../types/api'
import { AlertIcon, InfoIcon } from '../Icons'
import { Modal } from '../Modal'
import { TagEditor } from '../TagEditor'

interface PermissionTagsDialogProps {
  document: DocumentRead
  onClose: () => void
  onSaved: (document: DocumentRead) => void
}

function sameTags(a: string[], b: string[]) {
  return a.length === b.length && a.every((tag) => b.includes(tag))
}

/** 由父组件按需挂载；只改可见范围，不触发重新索引。 */
export function PermissionTagsDialog({ document, onClose, onSaved }: PermissionTagsDialogProps) {
  const original = document.permission_tags ?? []
  const [tags, setTags] = useState<string[]>(original)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unchanged = sameTags(tags, original)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (unchanged) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await updateDocumentPermissionTags(document.id, tags))
    } catch (caught) {
      setError(errorMessage(caught, '可见范围保存失败'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="可见范围"
      eyebrow="Document ACL"
      description="用户角色的权限标签与文档标签有任意交集即可在问答与文档库中看到它；不设置标签表示公开。"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            form="permission-tags-form"
            className="btn btn--primary"
            disabled={busy || unchanged}
          >
            {busy ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <form id="permission-tags-form" className="doc-dialog" onSubmit={handleSubmit}>
        <TagEditor label="权限标签" value={tags} onChange={setTags} disabled={busy} />
        <div className="inline-note">
          <InfoIcon size={15} />
          <p>
            保存后立即生效：当前为「{permissionScopeText(document.permission_tags)}」，将改为「
            {permissionScopeText(tags)}」。拥有 <span className="mono">*</span> 标签的角色始终可见。
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
