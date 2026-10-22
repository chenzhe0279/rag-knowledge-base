import { useRef } from 'react'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import type { ComponentType, SVGProps } from 'react'
import type { MotionValue } from 'framer-motion'
import {
  ChatIcon,
  FileTextIcon,
  GridIcon,
  PulseIcon,
  SparkIcon,
} from '../icons'

type DockIcon = ComponentType<SVGProps<SVGSVGElement>>

interface DockItem {
  id: string
  label: string
  icon: DockIcon
  active?: boolean
}

interface DashboardDockProps {
  hidden: boolean
  onOverview: () => void
  onOpenModule: (module: 'trend' | 'insight') => void
  onNavigate: (view: 'documents' | 'chat') => void
}

const DOCK_ITEMS: DockItem[] = [
  { id: 'overview', label: '总览', icon: GridIcon, active: true },
  { id: 'trend', label: '趋势', icon: PulseIcon },
  { id: 'insight', label: '洞察', icon: SparkIcon },
  { id: 'documents', label: '文档', icon: FileTextIcon },
  { id: 'chat', label: '问答', icon: ChatIcon },
]

function DockButton({
  item,
  mouseX,
  reduceMotion,
  onClick,
}: {
  item: DockItem
  mouseX: MotionValue<number>
  reduceMotion: boolean
  onClick: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const Icon = item.icon

  const distance = useTransform(mouseX, (pointerX) => {
    if (!Number.isFinite(pointerX)) return 220
    const bounds = buttonRef.current?.getBoundingClientRect()
    if (!bounds) return 220
    return pointerX - (bounds.left + bounds.width / 2)
  })

  const scaleTarget = useTransform(
    distance,
    [-156, -72, 0, 72, 156],
    reduceMotion ? [1, 1, 1, 1, 1] : [1, 1.08, 1.36, 1.08, 1],
  )
  const scale = useSpring(scaleTarget, {
    stiffness: 420,
    damping: 27,
    mass: 0.2,
  })
  const y = useTransform(scale, [1, 1.36], [0, -5])
  const iconScale = useTransform(scale, [1, 1.36], [1, 0.88])

  return (
    <div className={`dock-slot ${item.active ? 'is-active' : ''}`}>
      <span className="dock-tooltip" aria-hidden="true">
        {item.label}
      </span>
      <motion.button
        ref={buttonRef}
        type="button"
        className={`dock-button ${item.active ? 'is-active' : ''}`}
        aria-label={item.label}
        aria-current={item.active ? 'page' : undefined}
        onClick={onClick}
        style={{ scale, y, transformOrigin: '50% 100%' }}
      >
        <motion.span className="dock-button__icon" style={{ scale: iconScale }}>
          <Icon />
        </motion.span>
        {item.active ? (
          <span className="dock-button__dot" aria-hidden="true" />
        ) : null}
      </motion.button>
    </div>
  )
}

/**
 * A five-icon floating glass dock. The pointer position is shared between
 * icons; each icon uses a gaussian-like falloff so neighbours rise with the
 * hovered item. Everything animates through transforms only.
 */
export function DashboardDock({
  hidden,
  onOverview,
  onOpenModule,
  onNavigate,
}: DashboardDockProps) {
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY)
  const reduceMotion = useReducedMotion() === true

  const runAction = (id: string) => {
    if (id === 'overview') {
      onOverview()
      return
    }
    if (id === 'trend' || id === 'insight') {
      onOpenModule(id)
      return
    }
    if (id === 'documents') {
      onNavigate('documents')
      return
    }
    if (id === 'chat') {
      onNavigate('chat')
    }
  }

  return (
    <motion.nav
      className={`dashboard-dock ${hidden ? 'is-hidden' : ''}`}
      aria-label="快捷导航"
      aria-hidden={hidden || undefined}
      initial={false}
      animate={{
        opacity: hidden ? 0 : 1,
        y: hidden ? 84 : 0,
      }}
      transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.75 }}
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
    >
      <div
        className="dashboard-dock__glass"
        onPointerMove={(event) => mouseX.set(event.clientX)}
        onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
      >
        <span className="dashboard-dock__sheen" aria-hidden="true" />
        {DOCK_ITEMS.map((item) => (
          <DockButton
            key={item.id}
            item={item}
            mouseX={mouseX}
            reduceMotion={reduceMotion}
            onClick={() => runAction(item.id)}
          />
        ))}
      </div>
    </motion.nav>
  )
}
