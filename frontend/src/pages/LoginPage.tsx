import { useState } from 'react'
import type { FormEvent } from 'react'
import { login } from '../api/auth'
import { setAuthToken } from '../lib/authSession'
import type { LoginResponse } from '../types/auth'
import { AlertIcon, BrandIcon, EyeIcon } from '../components/Icons'
import { Spinner } from '../components/Spinner'
import './LoginPage.css'

interface LoginPageProps {
  initialError?: string | null
  onLoggedIn: (session: LoginResponse) => void
}

export function LoginPage({ initialError = null, onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownError = error ?? (submitting ? null : initialError)

  const canSubmit =
    !submitting && username.trim().length > 0 && password.length > 0

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const session = await login(username.trim(), password)
      setAuthToken(session.access_token)
      onLoggedIn(session)
    } catch (loginError: unknown) {
      setError(
        loginError instanceof Error ? loginError.message : '登录失败，请稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-page__aurora" aria-hidden="true" />
      <header className="login-brand">
        <span className="login-brand__mark">
          <BrandIcon />
        </span>
        <span>
          <strong>RAG Knowledge Base</strong>
          <small>企业知识库控制台</small>
        </span>
      </header>

      <section className="login-hero" aria-labelledby="login-title">
        <p className="eyebrow">
          <span className="eyebrow__mark" aria-hidden="true" />
          SECURE KNOWLEDGE ACCESS
        </p>
        <h1 id="login-title">
          欢迎回来
          <br />
          <span>进入知识工作台</span>
        </h1>
        <p>
          用管理员分配的账号登录。系统会按角色合并文档权限标签，
          让每次检索、引用和问答都只发生在你有权访问的知识范围内。
        </p>
        <div className="login-hero__chips" aria-label="安全能力">
          <span>JWT</span>
          <span>RBAC</span>
          <span>Document ACL</span>
          <span>Traceable</span>
        </div>
      </section>

      <section className="login-card" aria-labelledby="login-card-title">
        <div className="login-card__head">
          <span className="login-card__eyebrow">SIGN IN</span>
          <h2 id="login-card-title">登录工作台</h2>
          <p>首次启动可使用后端 `.env` 中配置的默认管理员账号。</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="login-field">
            <span>用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              disabled={submitting}
              placeholder="请输入用户名"
            />
          </label>

          <label className="login-field">
            <span>密码</span>
            <div className="login-field__password">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={submitting}
                placeholder="请输入密码"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                tabIndex={-1}
              >
                <EyeIcon className="icon" />
              </button>
            </div>
          </label>

          {shownError ? (
            <div className="login-error" role="alert">
              <AlertIcon className="icon" />
              <p>{shownError}</p>
            </div>
          ) : null}

          <button
            type="submit"
            className="login-submit"
            disabled={!canSubmit}
          >
            {submitting ? <Spinner small label="正在登录" /> : null}
            {submitting ? '正在验证身份…' : '登录'}
          </button>
        </form>

        <footer className="login-card__footer">
          <span>JWT 会话</span>
          <i aria-hidden="true" />
          <span>权限变更实时生效</span>
        </footer>
      </section>

      <footer className="login-page__footer">
        <span>RAG Knowledge Base</span>
        <span>FastAPI · React · PostgreSQL</span>
      </footer>
    </main>
  )
}
