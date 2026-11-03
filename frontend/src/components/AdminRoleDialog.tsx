import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { createRole, updateRole } from '../api/admin'
import { CloseIcon, PlusIcon } from './Icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import type { RoleRead } from '../types/auth'

interface AdminRoleDialogProps {
  role: RoleRead | null
  onClose: () => void
  onSaved: (role: RoleRead) => void
}

const PRESET_TAGS = [
  'public',
  'hr',
  'finance',
  'engineering',
  'it',
  'legal',
  'executive',
]

export function AdminRoleDialog({
  role,
  onClose,
  onSaved,
}: AdminRoleDialogProps) {
  const isEdit = role !== null
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [tags, setTags] = useState<string[]>(role?.permission_tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  const addTag = (raw: string) => {
    const value = raw.trim().toLowerCase()
    if (!value || tags.includes(value)) {
      return
    }
    setTags((current) => [...current, value])
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    setTags((current) => current.filter((item) => item !== tag))
  }

  const handleTagInput = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagInput)
    }
    if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  const canSubmit = !saving && name.trim().length > 0

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const saved = isEdit && role
        ? await updateRole(role.id, {
            description: description.trim(),
            permission_tags: tags,
          })
        : await createRole({
            name: name.trim(),
            description: description.trim(),
            permission_tags: tags,
          })
      onSaved(saved)
      onClose()
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : '保存角色失败',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      labelledBy="admin-role-dialog-title"
      className="admin-dialog"
      closeDisabled={saving}
      onClose={onClose}
    >
      <form className="admin-dialog__form" onSubmit={submit}>
        <header className="admin-dialog__head">
          <div>
            <span className="admin-dialog__eyebrow">
              {isEdit ? 'EDIT ROLE' : 'NEW ROLE'}
            </span>
            <h2 id="admin-role-dialog-title">
              {isEdit ? '编辑角色' : '创建角色'}
            </h2>
          </div>
          <button
            type="button"
            className="admin-dialog__close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="admin-dialog__grid admin-dialog__grid--single">
          <label className="admin-field">
            <span>角色名称</span>
            <input
              ref={firstInputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isEdit || saving}
              placeholder="例如 auditor"
            />
            {isEdit ? <small>角色名是权限锚点，创建后不可修改</small> : null}
          </label>
          <label className="admin-field">
            <span>描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={saving}
              rows={4}
              maxLength={256}
              placeholder="说明这个角色能访问哪些知识"
            />
          </label>
        </div>

        <fieldset className="admin-tags-field">
          <legend>文档权限标签</legend>
          <p>
            标签会与文档的可见范围取交集。`*` 表示全量访问；空权限只能看到无标签的公开文档。
          </p>

          <div className="admin-tag-editor">
            {tags.length === 0 ? (
              <span className="admin-tag-editor__empty">尚未添加标签</span>
            ) : (
              tags.map((tag) => (
                <span key={tag} className="admin-tag">
                  <code>{tag}</code>
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    disabled={saving}
                    aria-label={`移除标签 ${tag}`}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))
            )}
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={handleTagInput}
              onBlur={() => {
                if (tagInput.trim()) {
                  addTag(tagInput)
                }
              }}
              disabled={saving}
              placeholder="输入自定义标签后回车"
            />
            <button
              type="button"
              className="admin-tag-editor__add"
              onClick={() => addTag(tagInput)}
              disabled={saving || !tagInput.trim()}
            >
              <PlusIcon className="icon" />
              添加
            </button>
          </div>

          <div className="admin-tag-presets">
            <span>常用标签</span>
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                disabled={saving || tags.includes(tag)}
              >
                + {tag}
              </button>
            ))}
            <button
              type="button"
              onClick={() => addTag('*')}
              disabled={saving || tags.includes('*')}
            >
              + *
            </button>
          </div>
        </fieldset>

        {error ? (
          <p className="admin-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="admin-dialog__actions">
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
            {saving ? <Spinner small label="正在保存" /> : <PlusIcon className="icon" />}
            {saving ? '保存中…' : isEdit ? '保存角色' : '创建角色'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
