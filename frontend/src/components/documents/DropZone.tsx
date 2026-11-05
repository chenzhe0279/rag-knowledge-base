import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { formatBytes } from '../../lib/format'
import { CloseIcon, UploadIcon } from '../Icons'
import './DocumentDialogs.css'

interface DropZoneProps {
  file: File | null
  onSelect: (file: File | null) => void
  accept: string
  hint: ReactNode
  disabled?: boolean
  label?: string
}

/** 拖拽 / 点击选择单个文件；具体校验由调用方完成。 */
export function DropZone({
  file,
  onSelect,
  accept,
  hint,
  disabled = false,
  label = '拖拽文件到这里，或点击选择',
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [dragging, setDragging] = useState(false)

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const dropped = event.dataTransfer.files[0]
    if (dropped) onSelect(dropped)
  }

  function clear() {
    onSelect(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="drop-zone-wrap">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
      />
      <label
        htmlFor={inputId}
        className="drop-zone"
        data-dragging={dragging || undefined}
        data-disabled={disabled || undefined}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <span className="drop-zone__icon" aria-hidden="true">
          <UploadIcon size={22} />
        </span>
        <span className="drop-zone__title">{label}</span>
        <span className="drop-zone__hint">{hint}</span>
      </label>
      {file ? (
        <div className="drop-zone__file">
          <div className="drop-zone__file-text">
            <strong title={file.name}>{file.name}</strong>
            <span className="num faint">{formatBytes(file.size)}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={clear}
            disabled={disabled}
            aria-label="移除已选文件"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
