import { useState, type FormEvent } from 'react'
import { login } from '../../api/auth'
import { errorMessage } from '../../api/http'
import { navigate } from '../../app/router'
import { useAuth } from '../../auth/useAuth'
import { Brand } from '../../components/Brand'
import { AlertIcon, EyeIcon, EyeOffIcon, InfoIcon, KeyIcon } from '../../components/Icons'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './LoginPage.css'

const FEATURES = [
  { title: '混合检索', desc: '向量 + 关键词召回，RRF 融合后精排' },
  { title: 'Agentic RAG', desc: '证据不足时自动改写、切换路由或拒答' },
  { title: '可追溯引用', desc: '每个回答都附带文档、页码与片段原文' },
]

export function LoginPage() {
  useDocumentTitle('登录')
  const { signIn, notice } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await login(username.trim(), password)
      signIn(response)
      navigate('/', { replace: true })
    } catch (err) {
      // 保留用户名，只清空密码，方便重新输入
      setPassword('')
      setError(errorMessage(err, '登录失败，请检查账号和密码'))
      setSubmitting(false)
    }
  }

  return (
    <div className="login">
      <header className="login__top">
        <Brand />
      </header>

      <main className="login__main">
        <section className="login__intro" aria-labelledby="login-intro-title">
          <span className="eyebrow">Knowledge Workspace</span>
          <h1 id="login-intro-title" className="hero-title">
            欢迎回来
            <span>进入知识工作台</span>
          </h1>
          <p className="hero-lead">
            上传企业文档，构建带权限隔离的知识库；用自然语言提问，获得可追溯、可校验的回答。
          </p>
          <div className="hero-tags">
            <span className="tech-tag">JWT</span>
            <span className="tech-tag">RBAC</span>
            <span className="tech-tag">Document ACL</span>
          </div>
          <ul className="login__features">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <strong>{feature.title}</strong>
                <span>{feature.desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="login__card glass" aria-labelledby="login-card-title">
          <div className="login__card-head">
            <span className="login__card-icon" aria-hidden="true">
              <KeyIcon size={20} />
            </span>
            <div>
              <h2 id="login-card-title" className="section-title">
                登录工作台
              </h2>
              <p className="muted">使用管理员分配的账号登录</p>
            </div>
          </div>

          {notice ? (
            <p className="inline-note" role="status">
              <InfoIcon size={16} />
              {notice}
            </p>
          ) : null}

          <form className="login__form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label className="field__label" htmlFor="login-username">
                用户名
              </label>
              <input
                id="login-username"
                className="input"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
                placeholder="请输入用户名"
                autoFocus
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="login-password">
                密码
              </label>
              <div className="login__password">
                <input
                  id="login-password"
                  className="input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  className="icon-btn login__toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  disabled={submitting}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            {error ? (
              <div className="inline-error" role="alert">
                <span className="inline-error__text">
                  <AlertIcon size={16} />
                  {error}
                </span>
              </div>
            ) : null}

            <button type="submit" className="btn btn--primary btn--block" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <span className="spinner spinner--sm" aria-hidden="true" />
                  正在验证身份…
                </>
              ) : (
                '登录'
              )}
            </button>
          </form>

          {import.meta.env.DEV ? (
            <p className="login__hint faint">默认账号由后端 .env 配置</p>
          ) : null}
        </section>
      </main>

      <footer className="login__footer">
        <span>FastAPI · PostgreSQL + pgvector · Redis · Celery · React 19</span>
        <span>© RAG Knowledge Base</span>
      </footer>
    </div>
  )
}
