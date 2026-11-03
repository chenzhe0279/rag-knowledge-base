import { useEffect, useState } from 'react'
import {
  deleteRole,
  deleteUser,
  listRoles,
  listUsers,
} from '../api/admin'
import {
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '../components/Icons'
import { AdminRoleDialog } from '../components/AdminRoleDialog'
import { AdminUserDialog } from '../components/AdminUserDialog'
import { Spinner } from '../components/Spinner'
import type { MeResponse, RoleRead, UserRead } from '../types/auth'
import './AdminPage.css'

interface AdminPageProps {
  session: MeResponse
}

type AdminTab = 'users' | 'roles'

export function AdminPage({ session }: AdminPageProps) {
  const [tab, setTab] = useState<AdminTab>('users')
  const [roles, setRoles] = useState<RoleRead[]>([])
  const [users, setUsers] = useState<UserRead[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRead | null>(null)
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleRead | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [roleList, userPage] = await Promise.all([
        listRoles(),
        listUsers(1, 100),
      ])
      setRoles(roleList)
      setUsers(userPage.items)
      setUserTotal(userPage.total)
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error ? loadError.message : '加载权限数据失败',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const openCreateUser = () => {
    setEditingUser(null)
    setUserDialogOpen(true)
  }

  const openEditUser = (user: UserRead) => {
    setEditingUser(user)
    setUserDialogOpen(true)
  }

  const handleUserSaved = (saved: UserRead) => {
    const exists = users.some((user) => user.id === saved.id)
    if (!exists) {
      setUserTotal((total) => total + 1)
    }
    setUsers((current) => {
      if (!exists) {
        return [saved, ...current]
      }
      return current.map((user) => (user.id === saved.id ? saved : user))
    })
  }

  const removeUser = async (user: UserRead) => {
    if (user.id === session.user.id) {
      return
    }
    if (!window.confirm(`确认删除用户「${user.display_name}」？该操作不可撤销。`)) {
      return
    }
    try {
      await deleteUser(user.id)
      setUsers((current) => current.filter((item) => item.id !== user.id))
      setUserTotal((total) => Math.max(0, total - 1))
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error ? deleteError.message : '删除用户失败',
      )
    }
  }

  const openCreateRole = () => {
    setEditingRole(null)
    setRoleDialogOpen(true)
  }

  const openEditRole = (role: RoleRead) => {
    setEditingRole(role)
    setRoleDialogOpen(true)
  }

  const handleRoleSaved = (saved: RoleRead) => {
    setRoles((current) => {
      const exists = current.some((role) => role.id === saved.id)
      if (!exists) {
        return [...current, saved]
      }
      return current.map((role) => (role.id === saved.id ? saved : role))
    })
  }

  const removeRole = async (role: RoleRead) => {
    if (!window.confirm(`确认删除角色「${role.name}」？`)) {
      return
    }
    try {
      await deleteRole(role.id)
      setRoles((current) => current.filter((item) => item.id !== role.id))
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error ? deleteError.message : '删除角色失败',
      )
    }
  }

  const builtinRoles = new Set(['admin', 'user'])

  return (
    <main className="admin-page">
      <section className="admin-hero">
        <div>
          <p className="eyebrow">
            <span className="eyebrow__mark" aria-hidden="true" />
            ACCESS CONTROL
          </p>
          <h1>
            用户与
            <br />
            <span>角色权限</span>
          </h1>
          <p>
            账号只负责身份，角色才决定可见的知识边界。把文档标签与角色标签对齐，
            检索、引用和问答会自动收敛到当前用户有权限的文档。
          </p>
        </div>

        <div className="admin-hero__summary">
          <div>
            <strong>{userTotal}</strong>
            <span>账号</span>
          </div>
          <div>
            <strong>{roles.length}</strong>
            <span>角色</span>
          </div>
          <div>
            <strong>
              {session.permission_tags.includes('*')
                ? 'ALL'
                : session.permission_tags.length}
            </strong>
            <span>我的权限</span>
          </div>
          <small>权限变更会在下一次请求立即生效</small>
        </div>
      </section>

      <div className="admin-toolbar">
        <div className="admin-tabs" role="tablist" aria-label="权限管理">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'users'}
            className={tab === 'users' ? 'is-active' : ''}
            onClick={() => setTab('users')}
          >
            用户管理
            <span>{userTotal}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'roles'}
            className={tab === 'roles' ? 'is-active' : ''}
            onClick={() => setTab('roles')}
          >
            角色管理
            <span>{roles.length}</span>
          </button>
        </div>

        <div className="admin-toolbar__actions">
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshIcon className="icon" />
            刷新
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            onClick={tab === 'users' ? openCreateUser : openCreateRole}
          >
            <PlusIcon className="icon" />
            {tab === 'users' ? '新建用户' : '新建角色'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="admin-alert" role="alert">
          <ShieldCheckIcon className="icon" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="admin-loading" role="status">
          <Spinner label="正在加载权限数据" />
          <span>正在读取账号与角色…</span>
        </div>
      ) : tab === 'users' ? (
        <section className="admin-panel" aria-label="用户列表">
          <header className="admin-panel__head">
            <div>
              <span className="admin-panel__eyebrow">IDENTITIES</span>
              <h2>账号</h2>
            </div>
            <p>共 {userTotal} 个账号 · 当前登录：{session.user.display_name}</p>
          </header>

          <div className="admin-user-list">
            <div className="admin-user-row admin-user-row--head" aria-hidden="true">
              <span>用户</span>
              <span>角色</span>
              <span>状态</span>
              <span>创建时间</span>
              <span>操作</span>
            </div>
            {users.length === 0 ? (
              <p className="admin-empty">暂无用户。</p>
            ) : (
              users.map((user) => (
                <article className="admin-user-row" key={user.id}>
                  <div className="admin-user-cell">
                    <span className="admin-avatar">
                      {(user.display_name || user.username).slice(0, 1)}
                    </span>
                    <span>
                      <strong>{user.display_name}</strong>
                      <small>@{user.username}</small>
                    </span>
                    {user.id === session.user.id ? (
                      <em className="admin-self-tag">当前</em>
                    ) : null}
                  </div>

                  <div className="admin-role-chips">
                    {user.roles.length === 0 ? (
                      <span className="admin-muted">未分配</span>
                    ) : (
                      user.roles.map((role) => (
                        <span key={role.id} className="admin-role-chip">
                          {role.name}
                        </span>
                      ))
                    )}
                  </div>

                  <div>
                    <span
                      className={`admin-status admin-status--${user.status}`}
                    >
                      {user.status === 'active' ? '正常' : '已禁用'}
                    </span>
                  </div>

                  <time dateTime={user.created_at}>
                    {formatDate(user.created_at)}
                  </time>

                  <div className="admin-row-actions">
                    <button
                      type="button"
                      className="admin-icon-button"
                      onClick={() => openEditUser(user)}
                      aria-label={`编辑 ${user.display_name}`}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="admin-icon-button admin-icon-button--danger"
                      onClick={() => void removeUser(user)}
                      disabled={user.id === session.user.id}
                      aria-label={`删除 ${user.display_name}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : (
        <section className="admin-panel" aria-label="角色列表">
          <header className="admin-panel__head">
            <div>
              <span className="admin-panel__eyebrow">ROLES</span>
              <h2>角色</h2>
            </div>
            <p>角色权限是文档权限标签的并集</p>
          </header>

          {roles.length === 0 ? (
            <p className="admin-empty">暂无角色。</p>
          ) : (
            <div className="admin-role-grid">
              {roles.map((role) => (
                <article className="admin-role-card" key={role.id}>
                  <header>
                    <span className="admin-role-card__icon">
                      <ShieldCheckIcon />
                    </span>
                    <div>
                      <h3>{role.name}</h3>
                      <span>
                        {builtinRoles.has(role.name) ? '内置角色' : '自定义角色'}
                      </span>
                    </div>
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="admin-icon-button"
                        onClick={() => openEditRole(role)}
                        aria-label={`编辑角色 ${role.name}`}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className="admin-icon-button admin-icon-button--danger"
                        onClick={() => void removeRole(role)}
                        disabled={builtinRoles.has(role.name)}
                        aria-label={`删除角色 ${role.name}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </header>

                  <p>{role.description || '暂无描述'}</p>

                  <div className="admin-role-card__tags">
                    {role.permission_tags.length === 0 ? (
                      <span className="admin-muted">无权限标签</span>
                    ) : (
                      role.permission_tags.map((tag) => (
                        <code key={tag}>{tag}</code>
                      ))
                    )}
                  </div>

                  <footer>
                    <span>
                      {role.permission_tags.includes('*')
                        ? '全量文档访问'
                        : `${role.permission_tags.length} 个可见标签`}
                    </span>
                    <time dateTime={role.created_at}>
                      {formatDate(role.created_at)}
                    </time>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {userDialogOpen ? (
        <AdminUserDialog
          user={editingUser}
          roles={roles}
          currentUserId={session.user.id}
          onClose={() => setUserDialogOpen(false)}
          onSaved={handleUserSaved}
        />
      ) : null}

      {roleDialogOpen ? (
        <AdminRoleDialog
          role={editingRole}
          onClose={() => setRoleDialogOpen(false)}
          onSaved={handleRoleSaved}
        />
      ) : null}
    </main>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
