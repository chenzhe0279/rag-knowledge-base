import { API_BASE_URL } from '../config'
import { authFetch } from '../lib/authSession'
import type {
  CreateRolePayload,
  CreateUserPayload,
  RoleRead,
  UpdateRolePayload,
  UpdateUserPayload,
  UserPage,
  UserRead,
} from '../types/auth'
import { extractApiErrorMessage } from './documents'

export class AdminApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

async function request<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response

  try {
    response = await authFetch(`${API_BASE_URL}${input}`, init)
  } catch {
    throw new AdminApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload = await parseJson(response)

  if (!response.ok) {
    throw new AdminApiError(
      extractApiErrorMessage(
        payload,
        response.status === 403
          ? '仅管理员可执行该操作'
          : `请求失败（HTTP ${response.status}）`,
      ),
      response.status,
    )
  }

  return payload as T
}

async function requestVoid(
  input: string,
  init: RequestInit = {},
): Promise<void> {
  let response: Response

  try {
    response = await authFetch(`${API_BASE_URL}${input}`, init)
  } catch {
    throw new AdminApiError('无法连接后端服务，请确认服务已启动')
  }

  if (response.ok) {
    return
  }

  const payload = await parseJson(response)
  throw new AdminApiError(
    extractApiErrorMessage(payload, `请求失败（HTTP ${response.status}）`),
    response.status,
  )
}

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

export async function listRoles(): Promise<RoleRead[]> {
  return request<RoleRead[]>('/api/roles', {
    headers: { Accept: 'application/json' },
  })
}

export async function createRole(
  payload: CreateRolePayload,
): Promise<RoleRead> {
  return request<RoleRead>('/api/roles', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
}

export async function updateRole(
  roleId: string,
  payload: UpdateRolePayload,
): Promise<RoleRead> {
  return request<RoleRead>(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
}

export async function deleteRole(roleId: string): Promise<void> {
  return requestVoid(`/api/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
}

export async function listUsers(
  page = 1,
  pageSize = 20,
): Promise<UserPage> {
  return request<UserPage>(
    `/api/users?page=${page}&page_size=${pageSize}`,
    { headers: { Accept: 'application/json' } },
  )
}

export async function createUser(
  payload: CreateUserPayload,
): Promise<UserRead> {
  return request<UserRead>('/api/users', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
}

export async function updateUser(
  userId: string,
  payload: UpdateUserPayload,
): Promise<UserRead> {
  return request<UserRead>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
}

export async function assignUserRoles(
  userId: string,
  roleIds: string[],
): Promise<UserRead> {
  return request<UserRead>(
    `/api/users/${encodeURIComponent(userId)}/roles`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ role_ids: roleIds }),
    },
  )
}

export async function deleteUser(userId: string): Promise<void> {
  return requestVoid(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
}
