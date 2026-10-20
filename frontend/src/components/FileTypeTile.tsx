import { getDocumentKind, getDocumentKindLabel } from '../lib/documents'
import type { DocumentRead } from '../types/documents'

interface FileTypeTileProps {
  document: Pick<DocumentRead, 'name' | 'mime_type'>
  large?: boolean
}

export function FileTypeTile({ document, large = false }: FileTypeTileProps) {
  const kind = getDocumentKind(document)
  return (
    <span
      className={`file-tile file-tile--${kind}${large ? ' file-tile--lg' : ''}`}
      aria-hidden="true"
    >
      {getDocumentKindLabel(kind)}
    </span>
  )
}
