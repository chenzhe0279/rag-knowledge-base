import { useRef } from 'react'
import { ChevronRightIcon } from './Icons'
import type { MeResponse } from '../types/auth'

interface AccountMenuProps {
  session: MeResponse
  onManageUsers: () => void
  onLogout: () => void
}

export function AccountMenu({
  session,
  onManageUsers,
  onLogout,
}: AccountMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const user = session.user
  const initial = (user.display_name || user.username).slice(0, 1)
  const roleNames = user.roles.map((role) => role.name)

  const close = () => {
    detailsRef.current?.removeAttribute('open')
  }

  return (
    <details className="account-menu" ref={detailsRef}>
      <summary className="account-menu__summary">
        <span className="account-menu__avatar">{initial}</span>
        <span className="account-menu__copy">
          <strong>{user.display_name}</strong>
          <small>{roleNames.length > 0 ? roleNames.join(' · ') : '无角色'}</small>
        </span>
        <ChevronRightIcon className="account-menu__chevron" />
      </summary>

      <div className="account-menu__panel">
        <div className="account-menu__head">
          <span>{user.username}</span>
          <span
            className={`account-menu__status account-menu__status--${user.status}`}
          >
            {user.status === 'active' ? '正常' : '已禁用'}
          </span>
        </div>

        <div className="account-menu__permissions">
          <span>权限标签</span>
          <div>
            {session.permission_tags.length > 0 ? (
              session.permission_tags.map((tag) => (
                <code key={tag}>{tag}</code>
              ))
            ) : (
              <small>无可见文档权限</small>
            )}
          </div>
        </div>

        {session.is_admin ? (
          <button
            type="button"
            className="account-menu__action"
            onClick={() => {
              close()
              onManageUsers()
            }}
          >
            用户与角色管理
            <ChevronRightIcon className="icon" />
          </button>
        ) : null}

        <button
          type="button"
          className="account-menu__action account-menu__action--danger"
          onClick={() => {
            close()
            onLogout()
          }}
        >
          退出登录
        </button>
      </div>
    </details>
  )
}
