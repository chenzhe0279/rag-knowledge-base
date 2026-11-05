import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import { Fragment, useRef, type PointerEvent, type ReactNode } from 'react'
import { Link } from '../../app/Link'

/** 指针离开 Dock 时的“远处”坐标，保证所有图标回到原尺寸。 */
const FAR_AWAY = -10_000
const MAX_SCALE = 1.36
const INFLUENCE = 140
const DOCK_SPRING = { stiffness: 420, damping: 27 }

export interface DockItem {
  key: string
  label: string
  icon: ReactNode
  /** 站内跳转地址；与 onSelect 二选一。 */
  to?: string
  onSelect?: () => void
  active?: boolean
  /** 分组名变化时在两组之间画分隔线。 */
  group: string
}

export function Dock({ items }: { items: DockItem[] }) {
  const pointerX = useMotionValue(FAR_AWAY)

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse') pointerX.set(event.clientX)
  }

  return (
    <nav
      className="dash-dock"
      aria-label="快捷导航"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => pointerX.set(FAR_AWAY)}
    >
      <ul className="dash-dock__list">
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {index > 0 && items[index - 1].group !== item.group ? (
              <li className="dash-dock__divider" aria-hidden="true" />
            ) : null}
            <DockEntry item={item} pointerX={pointerX} />
          </Fragment>
        ))}
      </ul>
    </nav>
  )
}

function DockEntry({ item, pointerX }: { item: DockItem; pointerX: MotionValue<number> }) {
  const ref = useRef<HTMLLIElement>(null)
  const reduceMotion = useReducedMotion()
  const distance = useTransform(pointerX, (x) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || x === FAR_AWAY) return INFLUENCE * 4
    return x - (rect.left + rect.width / 2)
  })
  const targetScale = useTransform(distance, [-INFLUENCE, 0, INFLUENCE], [1, MAX_SCALE, 1])
  const scale = useSpring(targetScale, DOCK_SPRING)
  const y = useTransform(scale, (value) => (value - 1) * -22)

  const icon = (
    <motion.span className="dash-dock__icon" style={reduceMotion ? undefined : { scale, y }}>
      {item.icon}
    </motion.span>
  )
  const tooltip = (
    <span className="dash-dock__tip" aria-hidden="true">
      {item.label}
    </span>
  )

  return (
    <li ref={ref} className="dash-dock__item" data-active={item.active ?? false}>
      {item.to ? (
        <Link to={item.to} className="dash-dock__btn" aria-label={item.label}>
          {icon}
          {tooltip}
        </Link>
      ) : (
        <button
          type="button"
          className="dash-dock__btn"
          aria-label={item.label}
          aria-pressed={item.active ?? false}
          onClick={item.onSelect}
        >
          {icon}
          {tooltip}
        </button>
      )}
    </li>
  )
}
