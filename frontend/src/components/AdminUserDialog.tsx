import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  assignUserRoles,
  createUser,
  updateUser,
} from '../api/admin'
import { CloseIcon, PlusIcon } from './Icons'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import type {
  RoleRead,
  UserRead,
  UserStatusValue,
} from '../types/auth'

interface AdminUserDialogProps {
  user: UserRead | null
  roles: RoleRead[]
  currentUserId: string
  onClose: () => void
  onSaved: (user: UserRead) => void
}

export function AdminUserDialog({
  user,
  roles,
  currentUserId,
  onClose,
  onSaved,
}: AdminUserDialogProps) {
  const isEdit = user !== null
  const isSelf = user?.id === currentUserId
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<UserStatusValue>(
    user?.status ?? 'active',
  )
  const [roleIds, setRoleIds] = useState<string[]>(
    user?.roles.map((role) => role.id) ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  const toggleRole = (roleId: string) => {
    if (isSelf) {
      return
    }
    setRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    )
  }

  const canSubmit =
    !saving &&
    displayName.trim().length > 0 &&
    (isEdit || username.trim().length >= 2) &&
    (isEdit ? password.length === 0 || password.length >= 4 : password.length >= 4)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || (!isEdit && !username.trim())) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      let saved: UserRead
      if (isEdit && user) {
        saved = await updateUser(user.id, {
          display_name: displayName.trim(),
          ...(isSelf ? {} : { status }),
          ...(password ? { password } : {}),
        })
        if (!isSelf) {
          const currentRoleIds = new Set(user.roles.map((role) => role.id))
          const changed =
            roleIds.length !== currentRoleIds.size ||
            roleIds.some((id) => !currentRoleIds.has(id))
          if (changed) {
            saved = await assignUserRoles(user.id, roleIds)
          }
        }
      } else {
        saved = await createUser({
          username: username.trim(),
          password,
          display_name: displayName.trim(),
          role_ids: roleIds,
        })
      }
      onSaved(saved)
      onClose()
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : '保存用户失败',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      labelledBy="admin-user-dialog-title"
      className="admin-dialog"
      closeDisabled={saving}
      onClose={onClose}
    >
      <form className="admin-dialog__form" onSubmit={submit}>
        <header className="admin-dialog__head">
          <div>
            <span className="admin-dialog__eyebrow">
              {isEdit ? 'EDIT USER' : 'NEW USER'}
            </span>
            <h2 id="admin-user-dialog-title">
              {isEdit ? '编辑用户' : '创建用户'}
            </h2>
          </div>
          <button
            type="button"
            className="admin-dialog__close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="admin-dialog__grid">
          <label className="admin-field">
            <span>用户名</span>
            <input
              ref={firstInputRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={isEdit || saving}
              autoComplete="off"
              placeholder="登录账号，2–64 个字符"
            />
          </label>
          <label className="admin-field">
            <span>昵称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={saving}
              placeholder="展示名称"
            />
          </label>
          <label className="admin-field">
            <span>{isEdit ? '重置密码（可选）' : '初始密码'}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={saving}
              autoComplete="new-password"
              placeholder={isEdit ? '留空则不修改' : '至少 4 个字符'}
            />
          </label>
          <label className="admin-field">
            <span>账号状态</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as UserStatusValue)
              }
              disabled={saving || isSelf}
            >
              <option value="active">正常</option>
              <option value="disabled">禁用</option>
            </select>
            {isSelf ? <small>当前登录账号不能禁用自身</small> : null}
          </label>
        </div>

        <fieldset className="admin-roles-field">
          <legend>分配角色</legend>
          {roles.length === 0 ? (
            <p>暂无角色，请先创建角色。</p>
          ) : (
            <div className="admin-role-options">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className={`admin-role-option ${
                    roleIds.includes(role.id) ? 'is-selected' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={roleIds.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    disabled={saving || isSelf}
                  />
                  <span>
                    <strong>{role.name}</strong>
                    <small>{role.description || '暂无描述'}</small>
                  </span>
                  <code>{role.permission_tags.join(' · ') || '无权限'}</code>
                </label>
              ))}
            </div>
          )}
          {isSelf ? <small>当前登录账号不能修改自身角色</small> : null}
        </fieldset>

        {error ? (
          <p className="admin-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="admin-dialog__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={!canSubmit}
          >
            {saving ? <Spinner small label="正在保存" /> : <PlusIcon className="icon" />}
            {saving ? '保存中…' : isEdit ? '保存用户' : '创建用户'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
