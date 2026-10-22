import { useLayoutEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import gsap from 'gsap'
import { recallNumber, rememberNumber } from '../numberMemory'

interface AnimatedNumberProps {
  value: number
  decimals?: number
  className?: string
  ariaLabel?: string
  duration?: number
  valueKey?: string
}

const formatterCache = new Map<number, Intl.NumberFormat>()

function getFormatter(decimals: number) {
  let formatter = formatterCache.get(decimals)

  if (!formatter) {
    formatter = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    formatterCache.set(decimals, formatter)
  }

  return formatter
}

/**
 * GSAP-driven numeric tween. The text node is written directly so the
 * surrounding React tree does not re-render every animation frame.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  className = '',
  ariaLabel,
  duration = 1.05,
  valueKey,
}: AnimatedNumberProps) {
  const nodeRef = useRef<HTMLSpanElement>(null)
  const displayedRef = useRef(0)
  const firstRunRef = useRef(true)
  const reduceMotion = useReducedMotion()
  const formatted = getFormatter(decimals).format(value)

  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) return

    const formatter = getFormatter(decimals)
    const remembered = firstRunRef.current
      ? recallNumber(valueKey)
      : undefined
    const from =
      remembered ?? (firstRunRef.current ? 0 : displayedRef.current)
    firstRunRef.current = false
    displayedRef.current = from

    const remember = (nextValue: number) => {
      rememberNumber(valueKey, nextValue)
    }

    if (reduceMotion || from === value) {
      node.textContent = formatter.format(value)
      displayedRef.current = value
      remember(value)
      return
    }

    node.textContent = formatter.format(from)
    remember(from)

    const proxy = { value: from }
    const tween = gsap.to(proxy, {
      value,
      duration,
      ease: 'power3.out',
      overwrite: true,
      onUpdate: () => {
        node.textContent = formatter.format(proxy.value)
        displayedRef.current = proxy.value
        remember(proxy.value)
      },
      onComplete: () => {
        node.textContent = formatter.format(value)
        displayedRef.current = value
        remember(value)
      },
    })

    return () => {
      tween.kill()
    }
  }, [decimals, duration, reduceMotion, value, valueKey])

  return (
    <span
      ref={nodeRef}
      className={`dash-number ${className}`.trim()}
      aria-label={ariaLabel ?? formatted}
    />
  )
}
