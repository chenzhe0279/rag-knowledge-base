import { API_BASE_URL } from '../config'
import { authFetch } from '../lib/authSession'
import { extractApiErrorMessage } from './documents'
import type {
  BadCaseCategoryValue,
  DatasetListResponse,
  EvaluationItem,
  EvaluationItemPage,
  EvaluationItemUpdate,
  EvaluationRun,
  EvaluationRunPage,
  EvaluationRunListItem,
} from '../types/evaluations'

export class EvaluationsApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'EvaluationsApiError'
    this.status = status
  }
}

function fallbackMessage(status?: number): string {
  if (status === 404) {
    return '评测资源不存在或已被删除'
  }
  if (status === 422) {
    return '评测请求参数不合法'
  }
  if (status === 500) {
    return '评测服务执行失败'
  }
  return status ? `请求失败（HTTP ${status}）` : '请求失败'
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response

  try {
    response = await authFetch(`${API_BASE_URL}${input}`, init)
  } catch {
    throw new EvaluationsApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload = await parseJson(response)

  if (!response.ok) {
    throw new EvaluationsApiError(
      extractApiErrorMessage(payload, fallbackMessage(response.status)),
      response.status,
    )
  }

  return payload as T
}

export async function listEvaluationDatasets(): Promise<DatasetListResponse> {
  return requestJson<DatasetListResponse>('/api/evaluations/datasets', {
    headers: { Accept: 'application/json' },
  })
}

export async function createEvaluationRun(
  name: string,
  datasetName: string,
): Promise<EvaluationRun> {
  return requestJson<EvaluationRun>('/api/evaluations/runs', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, dataset_name: datasetName }),
  })
}

export async function listEvaluationRuns(
  page = 1,
  pageSize = 8,
): Promise<EvaluationRunPage> {
  return requestJson<EvaluationRunPage>(
    `/api/evaluations/runs?page=${page}&page_size=${pageSize}`,
    { headers: { Accept: 'application/json' } },
  )
}

export async function getEvaluationRun(
  runId: string,
): Promise<EvaluationRun> {
  return requestJson<EvaluationRun>(
    `/api/evaluations/runs/${encodeURIComponent(runId)}`,
    { headers: { Accept: 'application/json' } },
  )
}

export async function deleteEvaluationRun(runId: string): Promise<void> {
  let response: Response

  try {
    response = await authFetch(
      `${API_BASE_URL}/api/evaluations/runs/${encodeURIComponent(runId)}`,
      {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      },
    )
  } catch {
    throw new EvaluationsApiError('无法连接后端服务，请确认服务已启动')
  }

  if (response.ok) {
    return
  }

  const payload = await parseJson(response)
  throw new EvaluationsApiError(
    extractApiErrorMessage(payload, fallbackMessage(response.status)),
    response.status,
  )
}

export interface ListEvaluationItemsParams {
  page?: number
  pageSize?: number
  badCaseOnly?: boolean
  category?: BadCaseCategoryValue | null
}

export async function listEvaluationItems(
  runId: string,
  params: ListEvaluationItemsParams = {},
): Promise<EvaluationItemPage> {
  const search = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 10),
    bad_case_only: String(params.badCaseOnly ?? false),
  })
  if (params.category) {
    search.set('category', params.category)
  }

  return requestJson<EvaluationItemPage>(
    `/api/evaluations/runs/${encodeURIComponent(runId)}/items?${search.toString()}`,
    { headers: { Accept: 'application/json' } },
  )
}

export async function getEvaluationItem(
  itemId: string,
): Promise<EvaluationItem> {
  return requestJson<EvaluationItem>(
    `/api/evaluations/items/${encodeURIComponent(itemId)}`,
    { headers: { Accept: 'application/json' } },
  )
}

export async function updateEvaluationItem(
  itemId: string,
  payload: EvaluationItemUpdate,
): Promise<EvaluationItem> {
  return requestJson<EvaluationItem>(
    `/api/evaluations/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
}

export function isEvaluationRunRunning(
  run: EvaluationRunListItem | EvaluationRun,
): boolean {
  return run.status === 'running'
}
