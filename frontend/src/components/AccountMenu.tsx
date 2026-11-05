import { useEffect, useRef } from 'react'
import { Link } from '../app/Link'
import { paths } from '../app/router'
import { useAuth, useSession } from '../auth/useAuth'
import { initials } from '../lib/format'
import { ChevronDownIcon, LogoutIcon, UsersIcon } from './Icons'
import './AccountMenu.css'

/**
 * 账号菜单：原生 <details>，键盘 Enter/Space 打开；
 * 点击外部、Esc、选择菜单项后关闭。
 */
export function AccountMenu() {
  const { signOut } = useAuth()
  const session = useSession()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const { user, isAdmin, permissionTags } = session
  const roleText = user.roles?.length
    ? user.roles.map((role) => role.name).join(' · ')
    : isAdmin
      ? 'admin'
      : '未分配角色'

  useEffect(() => {
    function close(event: Event) {
      const details = detailsRef.current
      if (!details?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        details.open = false
        details.querySelector('summary')?.focus()
        return
      }
      if (!details.contains(event.target as Node)) details.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  function closeMenu() {
    if (detailsRef.current) detailsRef.current.open = false
  }

  return (
    <details ref={detailsRef} className="account-menu">
      <summary className="account-menu__trigger" aria-label={`账号菜单：${user.display_name}`}>
        <span className="account-menu__avatar" aria-hidden="true">
          {initials(user.display_name || user.username)}
        </span>
        <span className="account-menu__who">
          <span className="account-menu__name">{user.display_name}</span>
          <span className="account-menu__role">{roleText}</span>
        </span>
        <ChevronDownIcon size={14} className="account-menu__chevron" />
      </summary>
      <div className="account-menu__popover">
        <div className="account-menu__profile">
          <span className="account-menu__avatar account-menu__avatar--lg" aria-hidden="true">
            {initials(user.display_name || user.username)}
          </span>
          <div className="account-menu__profile-text">
            <strong>{user.display_name}</strong>
            <span className="mono">@{user.username}</span>
          </div>
        </div>
        <dl className="account-menu__facts">
          <div>
            <dt>状态</dt>
            <dd>
              <span className="badge" data-tone={user.status === 'active' ? 'success' : 'danger'}>
                <span className="dot" aria-hidden="true" />
                {user.status === 'active' ? '正常' : '已禁用'}
              </span>
            </dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{roleText}</dd>
          </div>
          <div>
            <dt>权限标签</dt>
            <dd>
              {permissionTags.length ? (
                <span className="chip-list">
                  {permissionTags.map((tag) => (
                    <span key={tag} className="chip chip--accent">
                      {tag === '*' ? '* 全部文档' : tag}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="faint">仅公开文档</span>
              )}
            </dd>
          </div>
        </dl>
        <div className="account-menu__actions">
          {isAdmin ? (
            <Link to={paths.access()} className="account-menu__item" onClick={closeMenu}>
              <UsersIcon size={16} />
              用户与角色管理
            </Link>
          ) : null}
          <button
            type="button"
            className="account-menu__item account-menu__item--danger"
            onClick={() => {
              closeMenu()
              signOut()
            }}
          >
            <LogoutIcon size={16} />
            退出登录
          </button>
        </div>
      </div>
    </details>
  )
}
