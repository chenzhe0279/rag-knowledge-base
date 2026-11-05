import type {
  Page,
  RoleCreate,
  RoleRead,
  RoleUpdate,
  UserCreate,
  UserRead,
  UserUpdate,
} from '../types/api'
import { request } from './http'

export function listUsers(page: number, pageSize: number, signal?: AbortSignal) {
  return request<Page<UserRead>>('/users', { query: { page, page_size: pageSize }, signal })
}

export function createUser(payload: UserCreate) {
  return request<UserRead>('/users', { method: 'POST', json: payload })
}

export function updateUser(userId: string, payload: UserUpdate) {
  return request<UserRead>(`/users/${userId}`, { method: 'PATCH', json: payload })
}

export function assignUserRoles(userId: string, roleIds: string[]) {
  return request<UserRead>(`/users/${userId}/roles`, {
    method: 'PUT',
    json: { role_ids: roleIds },
  })
}

export function deleteUser(userId: string) {
  return request<void>(`/users/${userId}`, { method: 'DELETE' })
}

export function listRoles(signal?: AbortSignal) {
  return request<RoleRead[]>('/roles', { signal })
}

export function createRole(payload: RoleCreate) {
  return request<RoleRead>('/roles', { method: 'POST', json: payload })
}

export function updateRole(roleId: string, payload: RoleUpdate) {
  return request<RoleRead>(`/roles/${roleId}`, { method: 'PATCH', json: payload })
}

export function deleteRole(roleId: string) {
  return request<void>(`/roles/${roleId}`, { method: 'DELETE' })
}
