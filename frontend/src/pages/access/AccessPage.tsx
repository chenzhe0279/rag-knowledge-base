import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteRole, deleteUser, listRoles, listUsers } from '../../api/access'
import { errorMessage, isAbortError } from '../../api/http'
import { useAuth, useSession } from '../../auth/useAuth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  KeyIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
  UsersIcon,
} from '../../components/Icons'
import { Pagination } from '../../components/Pagination'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../components/toast/useToast'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatDate, formatNumber, initials } from '../../lib/format'
import type { Page, RoleRead, UserRead } from '../../types/api'
import { RoleDialog } from './RoleDialog'
import { UserDialog } from './UserDialog'
import './AccessPage.css'

const USER_PAGE_SIZE = 12
const PROTECTED_ROLES = new Set(['admin', 'user'])

type Tab = 'users' | 'roles'
type Editing<T> = { mode: 'create' } | { mode: 'edit'; target: T } | null

export function AccessPage() {
  useDocumentTitle('用户与权限')
  const session = useSession()
  const { refresh: refreshSession } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('users')

  // ---------- 用户 ----------
  const [userPage, setUserPage] = useState(1)
  const [users, setUsers] = useState<Page<UserRead> | null>(null)
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const usersControllerRef = useRef<AbortController | null>(null)

  const loadUsers = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      usersControllerRef.current?.abort()
      const controller = new AbortController()
      usersControllerRef.current = controller
      if (!opts.silent) setUsersLoading(true)
      try {
        const result = await listUsers(userPage, USER_PAGE_SIZE, controller.signal)
        if (!result.items.length && userPage > 1) {
          setUserPage((page) => page - 1)
          return
        }
        setUsers(result)
        setUsersError(null)
      } catch (caught) {
        if (isAbortError(caught)) return
        setUsersError(errorMessage(caught, '加载用户失败'))
      } finally {
        if (usersControllerRef.current === controller) setUsersLoading(false)
      }
    },
    [userPage],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0)
    return () => {
      window.clearTimeout(timer)
      usersControllerRef.current?.abort()
    }
  }, [loadUsers])

  // ---------- 角色 ----------
  const [roles, setRoles] = useState<RoleRead[] | null>(null)
  const [rolesLoading, setRolesLoading] = useState(true)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const rolesControllerRef = useRef<AbortController | null>(null)

  const loadRoles = useCallback(async () => {
    rolesControllerRef.current?.abort()
    const controller = new AbortController()
    rolesControllerRef.current = controller
    setRolesLoading(true)
    try {
      const result = await listRoles(controller.signal)
      setRoles(result)
      setRolesError(null)
    } catch (caught) {
      if (isAbortError(caught)) return
      setRolesError(errorMessage(caught, '加载角色失败'))
    } finally {
      if (rolesControllerRef.current === controller) setRolesLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRoles(), 0)
    return () => {
      window.clearTimeout(timer)
      rolesControllerRef.current?.abort()
    }
  }, [loadRoles])

  // ---------- 弹窗 ----------
  const [editingUser, setEditingUser] = useState<Editing<UserRead>>(null)
  const [editingRole, setEditingRole] = useState<Editing<RoleRead>>(null)
  const [deletingUser, setDeletingUser] = useState<UserRead | null>(null)
  const [deletingRole, setDeletingRole] = useState<RoleRead | null>(null)

  function handleUserSaved(user: UserRead, mode: 'create' | 'edit') {
    setEditingUser(null)
    toast.success(mode === 'create' ? `已创建用户 ${user.username}` : `已保存 ${user.display_name}`)
    if (mode === 'create') {
      void loadUsers({ silent: true })
    } else {
      setUsers((current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === user.id ? user : item)) }
          : current,
      )
      if (user.id === session.user.id) void refreshSession()
    }
  }

  function handleRoleSaved(role: RoleRead, mode: 'create' | 'edit') {
    setEditingRole(null)
    toast.success(mode === 'create' ? `已创建角色 ${role.name}` : `已保存角色 ${role.name}`)
    void loadRoles()
    // 用户卡片里展示的角色标签可能已变化
    if (mode === 'edit') void loadUsers({ silent: true })
  }

  async function confirmDeleteUser() {
    if (!deletingUser) return
    await deleteUser(deletingUser.id)
    toast.success(`已删除用户 ${deletingUser.username}`)
    setDeletingUser(null)
    void loadUsers({ silent: true })
  }

  async function confirmDeleteRole() {
    if (!deletingRole) return
    await deleteRole(deletingRole.id)
    toast.success(`已删除角色 ${deletingRole.name}`)
    setDeletingRole(null)
    void loadRoles()
    void loadUsers({ silent: true })
  }

  function refreshCurrent() {
    if (tab === 'users') void loadUsers()
    else void loadRoles()
  }

  const loading = tab === 'users' ? usersLoading : rolesLoading
  const myTags = session.permissionTags

  return (
    <main className="page">
      <section className="page-hero">
        <div className="page-hero__copy">
          <span className="eyebrow">Access Control</span>
          <h1 className="hero-title">
            用户与
            <span>角色权限</span>
          </h1>
          <p className="hero-lead">
            角色携带权限标签，文档也有权限标签，二者有任一交集即可检索与查看。`*`
            代表全部文档，没有标签的文档对所有人公开。
          </p>
        </div>
        <div className="page-hero__aside">
          <div className="dark-block access-summary">
            <span className="eyebrow">Directory</span>
            <dl className="access-summary__grid">
              <div>
                <dt>账号</dt>
                <dd className="num">{users ? formatNumber(users.total) : '—'}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd className="num">{roles ? roles.length : '—'}</dd>
              </div>
            </dl>
            <div className="access-summary__mine">
              <span>我的权限标签</span>
              <div className="chip-list">
                {myTags.length ? (
                  myTags.map((tag) => (
                    <span key={tag} className="chip chip--dark">
                      {tag === '*' ? '* 全部文档' : tag}
                    </span>
                  ))
                ) : (
                  <span className="chip chip--dark">仅公开文档</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="glass glass--pad access-panel">
        <div className="panel-head">
          <div className="tabs" role="tablist" aria-label="权限管理">
            <button
              type="button"
              role="tab"
              className="tab"
              id="access-tab-users"
              aria-controls="access-panel-users"
              aria-selected={tab === 'users'}
              onClick={() => setTab('users')}
            >
              用户管理
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              id="access-tab-roles"
              aria-controls="access-panel-roles"
              aria-selected={tab === 'roles'}
              onClick={() => setTab('roles')}
            >
              角色管理
            </button>
          </div>
          <div className="panel-head__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={refreshCurrent}
              disabled={loading}
            >
              <RefreshIcon size={15} className={loading ? 'spin' : undefined} />
              刷新
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                tab === 'users' ? setEditingUser({ mode: 'create' }) : setEditingRole({ mode: 'create' })
              }
              disabled={tab === 'users' && !roles}
            >
              <PlusIcon size={15} />
              {tab === 'users' ? '新建用户' : '新建角色'}
            </button>
          </div>
        </div>

        {tab === 'users' ? (
          <div role="tabpanel" id="access-panel-users" aria-labelledby="access-tab-users">
            {usersError ? (
              <ErrorState message={usersError} onRetry={() => void loadUsers()} />
            ) : !users ? (
              <div className="access-grid">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} height={176} radius={20} />
                ))}
              </div>
            ) : !users.items.length ? (
              <EmptyState icon={<UsersIcon size={22} />} title="还没有用户" />
            ) : (
              <>
                <ul className="access-grid" data-loading={usersLoading}>
                  {users.items.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      isSelf={user.id === session.user.id}
                      onEdit={() => setEditingUser({ mode: 'edit', target: user })}
                      onDelete={() => setDeletingUser(user)}
                    />
                  ))}
                </ul>
                <Pagination
                  page={userPage}
                  pageSize={USER_PAGE_SIZE}
                  total={users.total}
                  onChange={setUserPage}
                  disabled={usersLoading}
                  unit="个账号"
                />
              </>
            )}
          </div>
        ) : (
          <div role="tabpanel" id="access-panel-roles" aria-labelledby="access-tab-roles">
            {rolesError ? (
              <ErrorState message={rolesError} onRetry={() => void loadRoles()} />
            ) : !roles ? (
              <div className="access-grid">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} height={176} radius={20} />
                ))}
              </div>
            ) : !roles.length ? (
              <EmptyState icon={<ShieldIcon size={22} />} title="还没有角色" />
            ) : (
              <ul className="access-grid" data-loading={rolesLoading}>
                {roles.map((role) => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    onEdit={() => setEditingRole({ mode: 'edit', target: role })}
                    onDelete={() => setDeletingRole(role)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {editingUser ? (
        <UserDialog
          user={editingUser.mode === 'edit' ? editingUser.target : null}
          roles={roles ?? []}
          currentUserId={session.user.id}
          onClose={() => setEditingUser(null)}
          onSaved={handleUserSaved}
        />
      ) : null}

      {editingRole ? (
        <RoleDialog
          role={editingRole.mode === 'edit' ? editingRole.target : null}
          onClose={() => setEditingRole(null)}
          onSaved={handleRoleSaved}
        />
      ) : null}

      <ConfirmDialog
        open={!!deletingUser}
        title="删除用户"
        description={
          deletingUser
            ? `将永久删除账号「${deletingUser.username}」（${deletingUser.display_name}）及其会话记录，操作不可恢复。`
            : ''
        }
        confirmLabel="删除用户"
        onConfirm={confirmDeleteUser}
        onClose={() => setDeletingUser(null)}
      />

      <ConfirmDialog
        open={!!deletingRole}
        title="删除角色"
        description={
          deletingRole
            ? `将删除角色「${deletingRole.name}」，拥有该角色的用户会失去其权限标签。`
            : ''
        }
        confirmLabel="删除角色"
        onConfirm={confirmDeleteRole}
        onClose={() => setDeletingRole(null)}
      />
    </main>
  )
}

function UserCard({
  user,
  isSelf,
  onEdit,
  onDelete,
}: {
  user: UserRead
  isSelf: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const roles = user.roles ?? []
  const isAdmin = roles.some((role) => role.name === 'admin')
  return (
    <li className="access-card soft-card" data-disabled={user.status === 'disabled'}>
      <header className="access-card__head">
        <span className="access-avatar" data-admin={isAdmin} aria-hidden="true">
          {initials(user.display_name || user.username)}
        </span>
        <div className="access-card__title">
          <strong>
            {user.display_name}
            {isSelf ? <span className="chip chip--accent">当前</span> : null}
          </strong>
          <span className="mono faint">@{user.username}</span>
        </div>
        <StatusBadge
          tone={user.status === 'active' ? 'success' : 'pending'}
          label={user.status === 'active' ? '启用' : '已禁用'}
        />
      </header>

      <div className="chip-list access-card__chips">
        {roles.length ? (
          roles.map((role) => (
            <span key={role.id} className={role.name === 'admin' ? 'chip chip--accent' : 'chip'}>
              {role.name}
            </span>
          ))
        ) : (
          <span className="faint access-card__none">未分配角色</span>
        )}
      </div>

      <footer className="access-card__foot">
        <span className="faint num">创建于 {formatDate(user.created_at)}</span>
        <span className="access-card__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onEdit}
            aria-label={`编辑 ${user.display_name}`}
            title="编辑"
          >
            <PencilIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={onDelete}
            disabled={isSelf}
            aria-label={`删除 ${user.display_name}`}
            title={isSelf ? '不能删除当前登录的账号' : '删除'}
          >
            <TrashIcon size={15} />
          </button>
        </span>
      </footer>
    </li>
  )
}

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: RoleRead
  onEdit: () => void
  onDelete: () => void
}) {
  const builtIn = PROTECTED_ROLES.has(role.name)
  const tags = role.permission_tags ?? []
  return (
    <li className="access-card soft-card">
      <header className="access-card__head">
        <span className="access-avatar access-avatar--role" aria-hidden="true">
          <KeyIcon size={18} />
        </span>
        <div className="access-card__title">
          <strong>{role.name}</strong>
          <span className="faint">{role.description || '暂无描述'}</span>
        </div>
        <StatusBadge tone={builtIn ? 'accent' : 'info'} label={builtIn ? '内置' : '自定义'} />
      </header>

      <div className="chip-list access-card__chips">
        {tags.length ? (
          tags.map((tag) => (
            <span key={tag} className={tag === '*' ? 'chip chip--accent' : 'chip'}>
              {tag === '*' ? '* 全部文档' : tag}
            </span>
          ))
        ) : (
          <span className="faint access-card__none">无标签 · 仅公开文档</span>
        )}
      </div>

      <footer className="access-card__foot">
        <span className="faint num">创建于 {formatDate(role.created_at)}</span>
        <span className="access-card__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onEdit}
            aria-label={`编辑角色 ${role.name}`}
            title="编辑"
          >
            <PencilIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={onDelete}
            disabled={builtIn}
            aria-label={`删除角色 ${role.name}`}
            title={builtIn ? '内置角色不允许删除' : '删除'}
          >
            <TrashIcon size={15} />
          </button>
        </span>
      </footer>
    </li>
  )
}
