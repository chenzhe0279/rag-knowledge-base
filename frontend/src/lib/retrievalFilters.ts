export interface DocumentTypeOption {
  key: string
  label: string
  mimeTypes: string[]
}

/** 前端筛选状态：日期用 YYYY-MM-DD，发送前再转 ISO。 */
export interface ChatFilters {
  documentTypes: string[]
  createdFrom: string
  createdTo: string
}

/** 后端 ChatRequest.filters 的格式。 */
export interface ApiRetrievalFilters {
  mime_types: string[]
  created_from: string | null
  created_to: string | null
  document_ids?: string[]
}

export const DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  {
    key: 'pdf',
    label: 'PDF',
    mimeTypes: ['application/pdf'],
  },
  {
    key: 'docx',
    label: 'Word',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  {
    key: 'pptx',
    label: 'PPT',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  },
  {
    key: 'xlsx',
    label: 'Excel',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
  {
    key: 'markdown',
    label: 'Markdown',
    mimeTypes: ['text/markdown', 'text/x-markdown'],
  },
  {
    key: 'html',
    label: 'HTML',
    mimeTypes: ['text/html', 'application/xhtml+xml'],
  },
]

export function emptyChatFilters(): ChatFilters {
  return {
    documentTypes: [],
    createdFrom: '',
    createdTo: '',
  }
}

export function countActiveFilters(filters: ChatFilters): number {
  return (
    filters.documentTypes.length +
    (filters.createdFrom ? 1 : 0) +
    (filters.createdTo ? 1 : 0)
  )
}

export function hasActiveFilters(filters: ChatFilters): boolean {
  return countActiveFilters(filters) > 0
}

export function getFilterDateError(filters: ChatFilters): string | null {
  if (
    filters.createdFrom &&
    filters.createdTo &&
    filters.createdFrom > filters.createdTo
  ) {
    return '开始日期不能晚于结束日期'
  }
  return null
}

export function formatFilterSummary(filters: ChatFilters): string {
  const typeLabels = DOCUMENT_TYPE_OPTIONS.filter((option) =>
    filters.documentTypes.includes(option.key),
  ).map((option) => option.label)

  const parts: string[] = []
  if (typeLabels.length > 0) {
    parts.push(typeLabels.join('、'))
  }
  if (filters.createdFrom && filters.createdTo) {
    parts.push(`${filters.createdFrom} 至 ${filters.createdTo}`)
  } else if (filters.createdFrom) {
    parts.push(`${filters.createdFrom} 起`)
  } else if (filters.createdTo) {
    parts.push(`截至 ${filters.createdTo}`)
  }

  return parts.length > 0 ? parts.join(' · ') : '全部文档'
}

function selectedMimeTypes(filters: ChatFilters): string[] {
  const result = new Set<string>()
  for (const option of DOCUMENT_TYPE_OPTIONS) {
    if (filters.documentTypes.includes(option.key)) {
      for (const mimeType of option.mimeTypes) {
        result.add(mimeType)
      }
    }
  }
  return [...result]
}

/** 只有真正设置了条件时才发送 filters，避免后端收到空对象。 */
export function toApiFilters(
  filters: ChatFilters,
): ApiRetrievalFilters | null {
  if (!hasActiveFilters(filters) || getFilterDateError(filters)) {
    return null
  }

  return {
    mime_types: selectedMimeTypes(filters),
    created_from: filters.createdFrom
      ? new Date(`${filters.createdFrom}T00:00:00`).toISOString()
      : null,
    created_to: filters.createdTo
      ? new Date(`${filters.createdTo}T23:59:59.999`).toISOString()
      : null,
  }
}
