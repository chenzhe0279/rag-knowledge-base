import { useId, useState, type KeyboardEvent } from 'react'
import { parseTags } from '../lib/format'
import { PERMISSION_TAG_PRESETS } from '../lib/documents'
import { CloseIcon, PlusIcon } from './Icons'
import './TagEditor.css'

interface TagEditorProps {
  label: string
  value: string[]
  onChange: (tags: string[]) => void
  hint?: string
  /** 角色可以拥有 `*`（全部文档），文档标签不需要。 */
  allowWildcard?: boolean
  disabled?: boolean
}

const MAX_TAG_LENGTH = 64

export function TagEditor({
  label,
  value,
  onChange,
  hint,
  allowWildcard = false,
  disabled = false,
}: TagEditorProps) {
  const inputId = useId()
  const hintId = useId()
  const [draft, setDraft] = useState('')
  const presets = allowWildcard ? ['*', ...PERMISSION_TAG_PRESETS] : PERMISSION_TAG_PRESETS

  function addTags(input: string) {
    const incoming = parseTags(input).map((tag) => tag.slice(0, MAX_TAG_LENGTH))
    if (!incoming.length) return
    onChange(Array.from(new Set([...value, ...incoming])))
    setDraft('')
  }

  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag])
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault()
      addTags(draft)
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="field tag-editor">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="tag-editor__box" data-disabled={disabled || undefined}>
        {value.length ? (
          value.map((tag) => (
            <span key={tag} className="tag-editor__tag">
              {tag === '*' ? '* 全部文档' : tag}
              <button
                type="button"
                aria-label={`移除标签 ${tag}`}
                onClick={() => toggle(tag)}
                disabled={disabled}
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ))
        ) : (
          <span className="tag-editor__empty">未设置 · 公开</span>
        )}
        <input
          id={inputId}
          className="tag-editor__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addTags(draft)}
          placeholder="输入标签后回车，多个用逗号分隔"
          aria-describedby={hintId}
          disabled={disabled}
        />
      </div>
      <div className="tag-editor__presets" aria-label="常用标签">
        {presets.map((tag) => {
          const active = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              className="tag-editor__preset"
              aria-pressed={active}
              onClick={() => toggle(tag)}
              disabled={disabled}
            >
              {active ? null : <PlusIcon size={11} />}
              {tag}
            </button>
          )
        })}
      </div>
      <p id={hintId} className="field__hint">
        {hint ?? '留空表示公开；多个标签之间为“任一命中即可见”。'}
      </p>
    </div>
  )
}
