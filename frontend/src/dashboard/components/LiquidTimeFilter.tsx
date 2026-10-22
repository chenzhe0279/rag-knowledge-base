import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion'
import gsap from 'gsap'
import { PERIOD_OPTIONS, type PeriodKey } from '../dashboardData'
import { CalendarIcon, CheckIcon, ChevronDownIcon } from '../icons'

interface LiquidTimeFilterProps {
  value: PeriodKey
  onChange: (period: PeriodKey) => void
}

/**
 * The control folds into one glass capsule. Opening it uses an SVG gooey
 * filter plus a GSAP split timeline; choosing an option lets the droplets
 * melt back into the trigger while the dashboard interpolates in place.
 */
export function LiquidTimeFilter({ value, onChange }: LiquidTimeFilterProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const blobRefs = useRef<(HTMLSpanElement | null)[]>([])
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const reduceMotion = useReducedMotion()
  const selected = PERIOD_OPTIONS.find((option) => option.key === value) ??
    PERIOD_OPTIONS[PERIOD_OPTIONS.length - 1]
  const selectedIndex = Math.max(
    0,
    PERIOD_OPTIONS.findIndex((option) => option.key === value),
  )

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu(false)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenu, open])

  useLayoutEffect(() => {
    if (!open) return

    const panel = panelRef.current
    const blobs = blobRefs.current.filter(
      (blob): blob is HTMLSpanElement => Boolean(blob),
    )
    if (!panel || blobs.length === 0) return

    const frame = window.requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus({ preventScroll: true })
    })

    if (reduceMotion) return () => window.cancelAnimationFrame(frame)

    const sourceCenter = panel.offsetWidth - 52
    const context = gsap.context(() => {
      blobs.forEach((blob, index) => {
        const blobCenter = blob.offsetLeft + blob.offsetWidth / 2

        gsap.fromTo(
          blob,
          {
            x: sourceCenter - blobCenter,
            scaleX: 0.46,
            scaleY: 0.7,
            opacity: 0,
          },
          {
            x: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
            duration: 0.68,
            delay: index * 0.035,
            ease: 'elastic.out(1, 0.72)',
            overwrite: true,
          },
        )
      })
    }, panel)

    return () => {
      window.cancelAnimationFrame(frame)
      context.revert()
    }
  }, [open, reduceMotion, selectedIndex])

  const handleSelect = (period: PeriodKey) => {
    if (period !== value) onChange(period)
    closeMenu()
  }

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

    event.preventDefault()
    let nextIndex = index

    if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + PERIOD_OPTIONS.length) % PERIOD_OPTIONS.length
    } else if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % PERIOD_OPTIONS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = PERIOD_OPTIONS.length - 1
    }

    optionRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={`time-filter ${open ? 'is-open' : ''}`}
      aria-label="时间维度筛选"
    >
      <svg
        className="time-filter__filter-defs"
        aria-hidden="true"
        focusable="false"
        width="0"
        height="0"
      >
        <defs>
          <filter
            id="liquid-period-goo"
            x="-35%"
            y="-120%"
            width="170%"
            height="340%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="5.5"
              result="liquid-blur"
            />
            <feColorMatrix
              in="liquid-blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10"
              result="liquid-goo"
            />
            <feComposite
              in="SourceGraphic"
              in2="liquid-goo"
              operator="atop"
            />
          </filter>
        </defs>
      </svg>

      <motion.button
        ref={triggerRef}
        type="button"
        className="time-filter__trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="period-options"
        tabIndex={open ? -1 : 0}
        onClick={() => setOpen(true)}
        animate={{ opacity: open ? 0 : 1, scale: open ? 0.88 : 1 }}
        transition={{ duration: open ? 0.08 : 0.2, ease: 'easeOut' }}
      >
        <CalendarIcon className="time-filter__calendar" />
        <span className="time-filter__value">{selected.caption}</span>
        <ChevronDownIcon className="time-filter__chevron" />
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            id="period-options"
            className="time-filter__panel"
            role="group"
            aria-label="选择时间范围"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.58, x: 52 }}
            transition={{
              opacity: { duration: 0.16, ease: 'easeOut' },
              scale: reduceMotion
                ? { duration: 0 }
                : {
                    type: 'spring',
                    stiffness: 420,
                    damping: 30,
                    mass: 0.65,
                  },
              x: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
            }}
            style={{ transformOrigin: '100% 50%' }}
          >
            <span className="time-filter__panel-sheen" aria-hidden="true" />
            <div className="time-filter__liquid" aria-hidden="true">
              {PERIOD_OPTIONS.map((option, index) => (
                <span
                  key={option.key}
                  ref={(node) => {
                    blobRefs.current[index] = node
                  }}
                  className={`time-filter__blob ${
                    option.key === value ? 'is-active' : ''
                  }`}
                />
              ))}
            </div>

            <div className="time-filter__options">
              {PERIOD_OPTIONS.map((option, index) => {
                const isSelected = option.key === value

                return (
                  <motion.button
                    key={option.key}
                    ref={(node) => {
                      optionRefs.current[index] = node
                    }}
                    type="button"
                    className={`time-filter__option ${
                      isSelected ? 'is-active' : ''
                    }`}
                    aria-pressed={isSelected}
                    onClick={() => handleSelect(option.key)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    initial={{
                      opacity: 0,
                      y: reduceMotion ? 0 : 7,
                    }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: reduceMotion ? 0 : 0.12 + index * 0.035,
                      duration: 0.26,
                      ease: [0.2, 0.7, 0.2, 1],
                    }}
                  >
                    <span>{option.label}</span>
                    {isSelected ? (
                      <CheckIcon className="time-filter__check" />
                    ) : null}
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
