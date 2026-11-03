export type UserStatusValue = 'active' | 'disabled'

export interface RoleRead {
  id: string
  name: string
  description: string
  permission_tags: string[]
  created_at: string
}

export interface UserRead {
  id: string
  username: string
  display_name: string
  status: UserStatusValue
  roles: RoleRead[]
  created_at: string
  updated_at: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  user: UserRead
  permission_tags: string[]
  is_admin: boolean
}

export interface MeResponse {
  user: UserRead
  permission_tags: string[]
  is_admin: boolean
}

export interface UserPage {
  items: UserRead[]
  total: number
  page: number
  page_size: number
}

export interface CreateUserPayload {
  username: string
  password: string
  display_name: string
  role_ids: string[]
}

export interface UpdateUserPayload {
  display_name?: string
  status?: UserStatusValue
  password?: string
}

export interface CreateRolePayload {
  name: string
  description: string
  permission_tags: string[]
}

export interface UpdateRolePayload {
  description?: string
  permission_tags?: string[]
}
