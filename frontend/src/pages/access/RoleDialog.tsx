import { useState, type FormEvent } from 'react'
import { createRole, updateRole } from '../../api/access'
import { errorMessage } from '../../api/http'
import { AlertIcon } from '../../components/Icons'
import { Modal } from '../../components/Modal'
import { TagEditor } from '../../components/TagEditor'
import type { RoleRead, RoleUpdate } from '../../types/api'

const NAME_MAX = 64
const DESCRIPTION_MAX = 256

interface RoleDialogProps {
  /** null 表示新建。 */
  role: RoleRead | null
  onClose: () => void
  onSaved: (role: RoleRead, mode: 'create' | 'edit') => void
}

function sameTags(a: string[], b: string[]) {
  return a.length === b.length && a.every((tag) => b.includes(tag))
}

/** 始终打开，由父组件按需挂载。 */
export function RoleDialog({ role, onClose, onSaved }: RoleDialogProps) {
  const editing = !!role
  const originalTags = role?.permission_tags ?? []
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [tags, setTags] = useState<string[]>(originalTags)
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) {
      const trimmed = name.trim()
      if (!trimmed) {
        setNameError('角色名不能为空')
        return
      }
      if (trimmed.length > NAME_MAX) {
        setNameError(`角色名不能超过 ${NAME_MAX} 个字符`)
        return
      }
    }
    setNameError(null)
    setBusy(true)
    setSubmitError(null)
    try {
      if (!role) {
        const created = await createRole({
          name: name.trim(),
          description: description.trim(),
          permission_tags: tags,
        })
        onSaved(created, 'create')
        return
      }
      const payload: RoleUpdate = {}
      if (description.trim() !== role.description) payload.description = description.trim()
      if (!sameTags(tags, originalTags)) payload.permission_tags = tags
      const saved = Object.keys(payload).length ? await updateRole(role.id, payload) : role
      onSaved(saved, 'edit')
    } catch (caught) {
      setSubmitError(errorMessage(caught, editing ? '保存角色失败' : '创建角色失败'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      eyebrow={editing ? 'Edit role' : 'New role'}
      title={editing ? `编辑角色 · ${role.name}` : '新建角色'}
      description="用户能看到的文档 = 文档权限标签与其角色标签有任一交集；* 表示全部文档，空标签的文档对所有人公开。"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" form="role-form" className="btn btn--primary" disabled={busy}>
            {busy ? '正在保存…' : editing ? '保存修改' : '创建角色'}
          </button>
        </>
      }
    >
      <form id="role-form" className="access-form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span className="field__label">角色名</span>
          <input
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(null)
            }}
            disabled={busy || editing}
            maxLength={NAME_MAX}
            autoComplete="off"
            aria-invalid={!!nameError}
            autoFocus={!editing}
          />
          {nameError ? (
            <span className="field__error">{nameError}</span>
          ) : (
            <span className="field__hint">{editing ? '角色名创建后不可修改' : '例如 finance-reader'}</span>
          )}
        </label>

        <label className="field">
          <span className="field__label">描述</span>
          <textarea
            className="textarea"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            maxLength={DESCRIPTION_MAX}
            placeholder="这个角色适用于谁、能看哪些文档"
            autoFocus={editing}
          />
          <span className="field__hint num">
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </label>

        <TagEditor
          label="权限标签"
          value={tags}
          onChange={setTags}
          allowWildcard
          disabled={busy}
          hint="回车或逗号分隔添加；选择 * 代表可访问全部文档。"
        />

        {submitError ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={15} />
              {submitError}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
