import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { updateDocumentPermissionTags } from '../api/documents'
import { CloseIcon, PlusIcon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { Spinner } from '../components/Spinner'
import type { DocumentRead } from '../types/documents'

interface DocumentPermissionDialogProps {
  document: DocumentRead
  onClose: () => void
  onSaved: (document: DocumentRead) => void
}

const COMMON_TAGS = ['public', 'hr', 'finance', 'engineering', 'it', 'legal']

export function DocumentPermissionDialog({
  document,
  onClose,
  onSaved,
}: DocumentPermissionDialogProps) {
  const [tags, setTags] = useState<string[]>(
    document.permission_tags ?? [],
  )
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addTag = (raw: string) => {
    const value = raw.trim().toLowerCase()
    if (!value || tags.includes(value)) {
      return
    }
    setTags((current) => [...current, value])
    setTagInput('')
  }

  const handleInput = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagInput)
    }
    if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags((current) => current.slice(0, -1))
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await updateDocumentPermissionTags(
        document.id,
        tags,
      )
      onSaved(updated)
      onClose()
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : '更新可见范围失败',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      labelledBy="document-permission-title"
      className="document-permission-dialog"
      closeDisabled={saving}
      onClose={onClose}
    >
      <form className="document-permission-form" onSubmit={submit}>
        <header>
          <div>
            <span className="document-permission-form__eyebrow">
              DOCUMENT ACCESS
            </span>
            <h2 id="document-permission-title">文档可见范围</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </header>

        <p>
          留空表示公开，所有普通用户都能检索；添加标签后，只有拥有任一标签的角色可见。
          管理员始终可以访问全部文档。
        </p>

        <div className="document-permission-tags">
          {tags.length === 0 ? (
            <span className="document-permission-tags__empty">公开</span>
          ) : (
            tags.map((tag) => (
              <span key={tag} className="document-permission-tag">
                <code>{tag}</code>
                <button
                  type="button"
                  onClick={() =>
                    setTags((current) =>
                      current.filter((item) => item !== tag),
                    )
                  }
                  disabled={saving}
                  aria-label={`移除 ${tag}`}
                >
                  <CloseIcon />
                </button>
              </span>
            ))
          )}
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={handleInput}
            onBlur={() => {
              if (tagInput.trim()) {
                addTag(tagInput)
              }
            }}
            disabled={saving}
            placeholder="输入标签后回车"
          />
          <button
            type="button"
            className="document-permission-tags__add"
            onClick={() => addTag(tagInput)}
            disabled={saving || !tagInput.trim()}
          >
            <PlusIcon className="icon" />
            添加
          </button>
        </div>

        <div className="document-permission-presets">
          <span>常用</span>
          {COMMON_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              disabled={saving || tags.includes(tag)}
            >
              + {tag}
            </button>
          ))}
        </div>

        {error ? (
          <p className="document-permission-form__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer>
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
            disabled={saving}
          >
            {saving ? <Spinner small label="正在保存" /> : null}
            {saving ? '保存中…' : '保存可见范围'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
