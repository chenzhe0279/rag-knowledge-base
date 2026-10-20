import { useState } from 'react'
import { getDocumentThumbnailUrl, resolveApiAssetUrl } from '../api/documents'
import { getDocumentKind, getDocumentKindLabel } from '../lib/documents'
import type { DocumentRead } from '../types/documents'

interface DocumentThumbnailProps {
  document: DocumentRead
}

/**
 * 文档首页缩略图。
 *
 * 后端实现 `thumbnail_url` 时优先使用该地址；尚未实现或加载失败时，
 * 自动回退到带文件类型标识的渐变占位图，避免列表出现破图。
 */
export function DocumentThumbnail({ document }: DocumentThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const kind = getDocumentKind(document)
  const label = getDocumentKindLabel(kind)
  const knownThumbnail =
    typeof document.thumbnail_url === 'string' && document.thumbnail_url.length > 0
      ? document.thumbnail_url
      : null
  const canTryImage = !failed && document.thumbnail_url !== null
  const imageSrc = knownThumbnail
    ? resolveApiAssetUrl(knownThumbnail)
    : getDocumentThumbnailUrl(document.id, document.updated_at)

  return (
    <div className={`document-thumbnail document-thumbnail--${kind}`}>
      <div className="document-thumbnail__fallback" aria-hidden="true">
        <span className="document-thumbnail__glyph">{label}</span>
        <span className="document-thumbnail__lines">
          <i />
          <i />
          <i />
        </span>
      </div>
      {canTryImage ? (
        <img
          className="document-thumbnail__image"
          src={imageSrc}
          alt={`${document.name} 首页缩略图`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="document-thumbnail__kind">{label}</span>
      <span className="document-thumbnail__shade" aria-hidden="true" />
    </div>
  )
}
