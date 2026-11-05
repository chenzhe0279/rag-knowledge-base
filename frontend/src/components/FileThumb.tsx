import { useState } from 'react'
import { FILE_KIND_LABEL, type FileKind } from '../lib/documents'
import './FileThumb.css'

interface FileThumbProps {
  kind: FileKind
  /** 后端缩略图地址；为空或加载失败时回退到文件类型渐变占位。 */
  src?: string | null
  variant?: 'cover' | 'tile'
  className?: string
}

export function FileThumb({ kind, src, variant = 'cover', className }: FileThumbProps) {
  // 记录失败的地址而不是布尔值：src 变化（例如更新缩略图）后自动重试
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  const label = FILE_KIND_LABEL[kind]
  const classes = ['file-thumb', `file-thumb--${variant}`, className ?? ''].filter(Boolean).join(' ')

  return (
    <div className={classes} data-kind={kind} aria-hidden="true">
      {showImage && src ? (
        <img
          className="file-thumb__img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="file-thumb__placeholder">
          <span className="file-thumb__kind">{label}</span>
          {variant === 'cover' ? (
            <span className="file-thumb__lines">
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </div>
      )}
      {variant === 'cover' ? <span className="file-thumb__chip">{label}</span> : null}
    </div>
  )
}
