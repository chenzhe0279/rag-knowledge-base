import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'framer-motion'
import type { CardTone } from '../dashboardData'

interface TiltCardProps {
  children: ReactNode
  tone?: CardTone
  interactive?: boolean
  className?: string
}

const MAX_TILT = 3.6

/**
 * A shared glass surface with a cursor spotlight, a locally-lit border and
 * a restrained perspective tilt (max 3.6deg).
 */
export function TiltCard({
  children,
  tone = 'glass',
  interactive = true,
  className = '',
}: TiltCardProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const reduceMotion = useReducedMotion()
  const rotateX = useSpring(0, { stiffness: 170, damping: 24, mass: 0.55 })
  const rotateY = useSpring(0, { stiffness: 170, damping: 24, mass: 0.55 })
  const spotX = useMotionValue(-480)
  const spotY = useMotionValue(-480)

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.pointerType === 'touch') return

    const surface = surfaceRef.current
    if (!surface) return

    const rect = surface.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    spotX.set(x)
    spotY.set(y)
    surface.style.setProperty('--edge-x', `${x}px`)
    surface.style.setProperty('--edge-y', `${y}px`)

    if (reduceMotion) return

    const relativeX = x / rect.width - 0.5
    const relativeY = y / rect.height - 0.5
    rotateX.set(relativeY * MAX_TILT * -2)
    rotateY.set(relativeX * MAX_TILT * 2)
  }

  const handlePointerEnter = () => {
    if (!interactive) return
    setHovered(true)
  }

  const handlePointerLeave = () => {
    if (!interactive) return
    setHovered(false)
    rotateX.set(0)
    rotateY.set(0)
    spotX.set(-480)
    spotY.set(-480)
  }

  return (
    <div className={`dash-tilt ${className}`.trim()}>
      <motion.div
        ref={surfaceRef}
        className={`dash-tilt__surface dash-tilt__surface--${tone} ${
          hovered ? 'is-hovering' : ''
        }`}
        data-tone={tone}
        onPointerMove={interactive ? handlePointerMove : undefined}
        onPointerEnter={interactive ? handlePointerEnter : undefined}
        onPointerLeave={interactive ? handlePointerLeave : undefined}
        style={
          interactive
            ? {
                rotateX,
                rotateY,
                transformStyle: 'preserve-3d',
                willChange: 'transform',
              }
            : undefined
        }
      >
        <motion.span
          className="dash-tilt__spotlight"
          aria-hidden="true"
          style={
            interactive
              ? {
                  x: spotX,
                  y: spotY,
                }
              : undefined
          }
        />
        <span className="dash-tilt__edge" aria-hidden="true" />
        <span className="dash-tilt__top-sheen" aria-hidden="true" />
        <div className="dash-tilt__content">{children}</div>
      </motion.div>
    </div>
  )
}
