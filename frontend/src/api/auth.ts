import { API_BASE_URL } from '../config'
import { authFetch, notifyAuthExpired } from '../lib/authSession'
import type { LoginResponse, MeResponse } from '../types/auth'
import { extractApiErrorMessage } from './documents'

export class AuthApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
  }
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new AuthApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload = await parseJson(response)

  if (!response.ok) {
    throw new AuthApiError(
      extractApiErrorMessage(
        payload,
        response.status === 401
          ? '用户名或密码错误'
          : `登录失败（HTTP ${response.status}）`,
      ),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as LoginResponse).access_token !== 'string' ||
    !(payload as LoginResponse).user
  ) {
    throw new AuthApiError('登录接口返回的数据结构不符合预期')
  }

  return payload as LoginResponse
}

export async function getMe(): Promise<MeResponse> {
  let response: Response

  try {
    response = await authFetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    throw new AuthApiError('无法连接后端服务，请确认服务已启动')
  }

  const payload = await parseJson(response)

  if (response.status === 401) {
    notifyAuthExpired('登录状态已失效，请重新登录')
    throw new AuthApiError('登录状态已失效，请重新登录', 401)
  }

  if (!response.ok) {
    throw new AuthApiError(
      extractApiErrorMessage(
        payload,
        `获取用户信息失败（HTTP ${response.status}）`,
      ),
      response.status,
    )
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !(payload as MeResponse).user
  ) {
    throw new AuthApiError('用户信息接口返回的数据结构不符合预期')
  }

  return payload as MeResponse
}
