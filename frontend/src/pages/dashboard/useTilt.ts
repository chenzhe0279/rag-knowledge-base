import { useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import type { PointerEvent } from 'react'

const MAX_TILT = 4.5
const TILT_SPRING = { stiffness: 260, damping: 24 }

/**
 * 卡片轻微 3D tilt：仅响应鼠标指针，离开后弹簧回正；
 * 系统开启“减少动态效果”时完全不倾斜。
 */
export function useTilt() {
  const reduceMotion = useReducedMotion()
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [MAX_TILT, -MAX_TILT]), TILT_SPRING)
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-MAX_TILT, MAX_TILT]), TILT_SPRING)

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (reduceMotion || event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5)
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5)
  }

  function onPointerLeave() {
    pointerX.set(0)
    pointerY.set(0)
  }

  return {
    style: { rotateX, rotateY, transformPerspective: 900 },
    onPointerMove,
    onPointerLeave,
  }
}
