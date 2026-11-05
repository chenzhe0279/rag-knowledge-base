import { useState, type FormEvent } from 'react'
import { assignUserRoles, createUser, updateUser } from '../../api/access'
import { errorMessage } from '../../api/http'
import { AlertIcon, EyeIcon, EyeOffIcon, InfoIcon } from '../../components/Icons'
import { Modal } from '../../components/Modal'
import type { RoleRead, UserRead, UserStatus, UserUpdate } from '../../types/api'

const USERNAME_MIN = 2
const USERNAME_MAX = 64
const PASSWORD_MIN = 4
const PASSWORD_MAX = 128
const DISPLAY_NAME_MAX = 128

interface UserDialogProps {
  /** null 表示新建。 */
  user: UserRead | null
  roles: RoleRead[]
  currentUserId: string
  onClose: () => void
  onSaved: (user: UserRead, mode: 'create' | 'edit') => void
}

type Errors = Partial<Record<'username' | 'displayName' | 'password' | 'roles', string>>

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/** 始终打开，由父组件按需挂载。 */
export function UserDialog({ user, roles, currentUserId, onClose, onSaved }: UserDialogProps) {
  const editing = !!user
  const isSelf = user?.id === currentUserId
  const originalRoleIds = user?.roles?.map((role) => role.id) ?? []
  const defaultRoleIds = editing
    ? originalRoleIds
    : roles.filter((role) => role.name === 'user').map((role) => role.id)

  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState<UserStatus>(user?.status ?? 'active')
  const [roleIds, setRoleIds] = useState<string[]>(defaultRoleIds)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function validate(): Errors {
    const next: Errors = {}
    const name = username.trim()
    if (!editing) {
      if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
        next.username = `用户名长度需为 ${USERNAME_MIN}–${USERNAME_MAX} 个字符`
      }
    }
    const display = displayName.trim()
    if (!display) next.displayName = '昵称不能为空'
    else if (display.length > DISPLAY_NAME_MAX) next.displayName = `昵称不能超过 ${DISPLAY_NAME_MAX} 个字符`
    if (!editing || password) {
      if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        next.password = `密码长度需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 位`
      }
    }
    return next
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setSubmitError(null)
    try {
      if (!user) {
        const created = await createUser({
          username: username.trim(),
          password,
          display_name: displayName.trim(),
          role_ids: roleIds,
        })
        onSaved(created, 'create')
        return
      }
      const payload: UserUpdate = {}
      if (displayName.trim() !== user.display_name) payload.display_name = displayName.trim()
      if (!isSelf && status !== user.status) payload.status = status
      if (password) payload.password = password
      let saved = user
      if (Object.keys(payload).length) saved = await updateUser(user.id, payload)
      if (!isSelf && !sameIds(roleIds, originalRoleIds)) {
        saved = await assignUserRoles(user.id, roleIds)
      }
      onSaved(saved, 'edit')
    } catch (caught) {
      setSubmitError(errorMessage(caught, editing ? '保存用户失败' : '创建用户失败'))
      setBusy(false)
    }
  }

  function toggleRole(id: string) {
    setRoleIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  return (
    <Modal
      open
      eyebrow={editing ? 'Edit account' : 'New account'}
      title={editing ? `编辑用户 · ${user.display_name}` : '新建用户'}
      description={
        editing ? '留空密码表示不修改。' : '新用户默认分配 user 角色，可在下方调整。'
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" form="user-form" className="btn btn--primary" disabled={busy}>
            {busy ? '正在保存…' : editing ? '保存修改' : '创建用户'}
          </button>
        </>
      }
    >
      <form id="user-form" className="access-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">用户名</span>
            <input
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy || editing}
              maxLength={USERNAME_MAX}
              autoComplete="off"
              aria-invalid={!!errors.username}
              autoFocus={!editing}
            />
            {errors.username ? (
              <span className="field__error">{errors.username}</span>
            ) : (
              <span className="field__hint">{editing ? '用户名创建后不可修改' : '用于登录，2–64 个字符'}</span>
            )}
          </label>

          <label className="field">
            <span className="field__label">昵称</span>
            <input
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={busy}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="off"
              aria-invalid={!!errors.displayName}
              autoFocus={editing}
            />
            {errors.displayName ? <span className="field__error">{errors.displayName}</span> : null}
          </label>

          <label className="field">
            <span className="field__label">{editing ? '重置密码' : '初始密码'}</span>
            <span className="access-password">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                maxLength={PASSWORD_MAX}
                autoComplete="new-password"
                placeholder={editing ? '不修改请留空' : '4–128 位'}
                aria-invalid={!!errors.password}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
              </button>
            </span>
            {errors.password ? <span className="field__error">{errors.password}</span> : null}
          </label>

          {editing ? (
            <div className="field">
              <span className="field__label">账号状态</span>
              <div className="segmented" role="group" aria-label="账号状态">
                <button
                  type="button"
                  aria-pressed={status === 'active'}
                  onClick={() => setStatus('active')}
                  disabled={busy || isSelf}
                >
                  启用
                </button>
                <button
                  type="button"
                  aria-pressed={status === 'disabled'}
                  onClick={() => setStatus('disabled')}
                  disabled={busy || isSelf}
                >
                  禁用
                </button>
              </div>
              <span className="field__hint">
                {isSelf ? '不能禁用当前登录的账号' : '禁用后该账号无法登录'}
              </span>
            </div>
          ) : null}

          <fieldset className="field form-grid--full access-roles" disabled={busy || isSelf}>
            <legend className="field__label">角色</legend>
            {roles.length ? (
              <div className="access-roles__list">
                {roles.map((role) => (
                  <label key={role.id} className="access-role-option" data-checked={roleIds.includes(role.id)}>
                    <input
                      type="checkbox"
                      checked={roleIds.includes(role.id)}
                      onChange={() => toggleRole(role.id)}
                    />
                    <span>
                      <strong>{role.name}</strong>
                      <small>{role.permission_tags?.length ? role.permission_tags.join(' · ') : '无标签'}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="field__hint">角色列表为空或尚未加载。</span>
            )}
            {isSelf ? (
              <div className="inline-note">
                <InfoIcon size={15} />
                <p>为避免误操作导致失去管理员权限，不能在这里修改自己的角色。</p>
              </div>
            ) : roleIds.length === 0 ? (
              <span className="field__hint">未分配角色的用户只能访问公开文档。</span>
            ) : null}
          </fieldset>
        </div>

        {submitError ? (
          <div className="inline-error" role="alert">
            <span className="inline-error__text">
              <AlertIcon size={15} />
              {submitError}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
