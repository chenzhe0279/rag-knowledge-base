import type { LoginResponse, MeResponse } from '../types/api'
import { request } from './http'

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    json: { username, password },
    auth: false,
  })
}

export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return request<MeResponse>('/auth/me', { signal })
}
