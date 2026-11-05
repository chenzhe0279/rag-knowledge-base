import type {
  BadCaseCategory,
  DatasetInfo,
  EvaluationItem,
  EvaluationItemUpdate,
  EvaluationRun,
  EvaluationRunListItem,
  Page,
} from '../types/api'
import { request } from './http'

export function listDatasets(signal?: AbortSignal) {
  return request<{ items: DatasetInfo[] }>('/evaluations/datasets', { signal })
}

export function createEvaluationRun(name: string, datasetName: string) {
  return request<EvaluationRun>('/evaluations/runs', {
    method: 'POST',
    json: { name, dataset_name: datasetName },
  })
}

export function listEvaluationRuns(page: number, pageSize: number, signal?: AbortSignal) {
  return request<Page<EvaluationRunListItem>>('/evaluations/runs', {
    query: { page, page_size: pageSize },
    signal,
  })
}

export function getEvaluationRun(runId: string, signal?: AbortSignal) {
  return request<EvaluationRun>(`/evaluations/runs/${runId}`, { signal })
}

export function deleteEvaluationRun(runId: string) {
  return request<void>(`/evaluations/runs/${runId}`, { method: 'DELETE' })
}

export function listEvaluationItems(
  runId: string,
  params: {
    page: number
    pageSize: number
    badCaseOnly?: boolean
    category?: BadCaseCategory | null
  },
  signal?: AbortSignal,
) {
  return request<Page<EvaluationItem>>(`/evaluations/runs/${runId}/items`, {
    query: {
      page: params.page,
      page_size: params.pageSize,
      bad_case_only: params.badCaseOnly ? true : undefined,
      category: params.category,
    },
    signal,
  })
}

export function getEvaluationItem(itemId: string, signal?: AbortSignal) {
  return request<EvaluationItem>(`/evaluations/items/${itemId}`, { signal })
}

export function updateEvaluationItem(itemId: string, payload: EvaluationItemUpdate) {
  return request<EvaluationItem>(`/evaluations/items/${itemId}`, {
    method: 'PATCH',
    json: payload,
  })
}
