import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  ModuleDetailContent,
  ModuleThumbContent,
} from './ModuleCards'
import { MODULE_META } from '../moduleMeta'
import {
  MODULE_ORDER,
  type ModuleKey,
  type PeriodData,
} from '../dashboardData'
import { TiltCard } from './TiltCard'
import { CloseIcon, GridIcon } from '../icons'

interface ModuleOverlayProps {
  activeModule: ModuleKey
  data: PeriodData
  onClose: () => void
  onSelect: (module: ModuleKey) => void
}

const MODULE_LAYOUT_SPRING = {
  type: 'spring' as const,
  stiffness: 250,
  damping: 30,
  mass: 0.82,
}

export function ModuleOverlay({
  activeModule,
  data,
  onClose,
  onSelect,
}: ModuleOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const meta = MODULE_META[activeModule]
  const inactiveModules = MODULE_ORDER.filter(
    (module) => module !== activeModule,
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    closeRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)

      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleThumbSelect = (module: ModuleKey) => {
    onSelect(module)
    window.requestAnimationFrame(() => closeRef.current?.focus())
  }

  return createPortal(
    <div
      ref={dialogRef}
      className="dash-detail"
      role="dialog"
      aria-modal="true"
      aria-label={`${meta.title}详情`}
    >
      <motion.div
        className="dash-detail__backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.32, ease: 'easeOut' }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="dash-detail__frame">
        <motion.div
          className="dash-detail__topbar"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05, ease: 'easeOut' }}
        >
          <span className="dash-detail__breadcrumb">
            <GridIcon />
            知识看板
            <i aria-hidden="true">/</i>
            <strong>{meta.title}</strong>
          </span>
          <button
            ref={closeRef}
            type="button"
            className="dash-detail__close"
            onClick={onClose}
            aria-label="关闭详情，返回总览"
          >
            <CloseIcon />
            <span>返回总览</span>
            <kbd>ESC</kbd>
          </button>
        </motion.div>

        <motion.article
          key={`detail-${activeModule}`}
          className={`dash-detail__card dash-detail__card--${meta.tone}`}
          layoutId={`dashboard-module-${activeModule}`}
          transition={MODULE_LAYOUT_SPRING}
        >
          <TiltCard
            tone={meta.tone}
            interactive={false}
            className="dash-detail__tilt"
          >
            <motion.div
              className="dash-detail__content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.12 }}
            >
              <ModuleDetailContent module={activeModule} data={data} />
            </motion.div>
          </TiltCard>
        </motion.article>

        <motion.div
          className="dash-thumb-rail"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.14 }}
          aria-label="切换看板模块"
        >
          <span className="dash-thumb-rail__label">
            <span>切换模块</span>
            <small>{inactiveModules.length} 个视图</small>
          </span>
          <div className="dash-thumb-rail__items">
            {inactiveModules.map((module) => {
              const moduleMeta = MODULE_META[module]

              return (
                <motion.button
                  key={module}
                  type="button"
                  className={`dash-module-thumb dash-module-thumb--${moduleMeta.tone}`}
                  layoutId={`dashboard-module-${module}`}
                  transition={MODULE_LAYOUT_SPRING}
                  onClick={() => handleThumbSelect(module)}
                  aria-label={`切换到${moduleMeta.title}`}
                >
                  <ModuleThumbContent module={module} data={data} />
                </motion.button>
              )
            })}
          </div>
        </motion.div>
      </div>
    </div>,
    document.body,
  )
}
