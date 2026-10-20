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
 * 后端生成缩略图后优先使用 `thumbnail_url`；尚未生成或加载失败时，
 * 自动回退到带文件类型标识的渐变占位图，避免列表出现破图。
 * 图片地址带上 updated_at 版本号，用户替换缩略图后可绕过浏览器缓存。
 */
export function DocumentThumbnail({ document }: DocumentThumbnailProps) {
  const kind = getDocumentKind(document)
  const label = getDocumentKindLabel(kind)
  const knownThumbnail =
    typeof document.thumbnail_url === 'string' && document.thumbnail_url.length > 0
      ? document.thumbnail_url
      : null
  const canTryImage = document.thumbnail_url !== null
  const imageSrc = knownThumbnail
    ? withCacheKey(resolveApiAssetUrl(knownThumbnail), document.updated_at)
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
        <ThumbnailImage
          key={imageSrc}
          src={imageSrc}
          alt={`${document.name} 首页缩略图`}
        />
      ) : null}
      <span className="document-thumbnail__kind">{label}</span>
      <span className="document-thumbnail__shade" aria-hidden="true" />
    </div>
  )
}

function ThumbnailImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return null
  }

  return (
    <img
      className="document-thumbnail__image"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function withCacheKey(url: string, version: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${encodeURIComponent(version)}`
}
