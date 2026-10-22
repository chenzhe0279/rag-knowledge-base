import { useState } from 'react'
import { motion } from 'framer-motion'
import { DASHBOARD_NAV, type DashboardView } from '../dashboardData'

interface GlassNavProps {
  active: DashboardView
  onChange: (view: DashboardView) => void
}

export function GlassNav({ active, onChange }: GlassNavProps) {
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const activeIndex = DASHBOARD_NAV.findIndex((item) => item.id === active)

  const handleSelect = (id: DashboardView, index: number) => {
    if (id === active) return
    setDirection(index > activeIndex ? 'forward' : 'backward')
    onChange(id)
  }

  return (
    <nav
      className="glass-nav"
      aria-label="看板分区"
      data-direction={direction}
    >
      <span className="glass-nav__grain" aria-hidden="true" />
      {DASHBOARD_NAV.map((item, index) => {
        const isActive = active === item.id

        return (
          <button
            key={item.id}
            type="button"
            className={`glass-nav__item ${isActive ? 'is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => handleSelect(item.id, index)}
          >
            {isActive ? (
              <motion.span
                layoutId="dashboard-nav-pill"
                className="glass-nav__pill"
                transition={{
                  layout: {
                    type: 'spring',
                    stiffness: 430,
                    damping: 27,
                    mass: 0.72,
                  },
                  opacity: { duration: 0.16 },
                }}
                aria-hidden="true"
              >
                <span className="glass-nav__pill-liquid" />
                <span className="glass-nav__pill-shine" />
              </motion.span>
            ) : null}
            <span className="glass-nav__label">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
