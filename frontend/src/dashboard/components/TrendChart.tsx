import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import gsap from 'gsap'
import { formatNumber, type ChartData } from '../dashboardData'

interface TrendChartProps {
  data: ChartData
  large?: boolean
}

const chartMemory = new Set<string>()

/**
 * A rounded, gradient-filled bar chart. Heights are interpolated by GSAP via
 * transform: scaleY only; the light track is the remaining (unmet) target.
 */
export function TrendChart({ data, large = false }: TrendChartProps) {
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([])
  const firstRunRef = useRef(true)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const reduceMotion = useReducedMotion()
  const peakValue = Math.max(...data.values)
  const domainMax = Math.max(peakValue, data.target) * 1.12
  const targetPercent = (data.target / domainMax) * 100
  const chartSignature = `${data.labels.join('|')}::${data.values.join(',')}`
  const accessibilityLabel = data.labels
    .map((label, index) => `${label} ${formatNumber(data.values[index])} 次`)
    .join('，')

  useLayoutEffect(() => {
    const fills = fillRefs.current.filter(
      (fill): fill is HTMLSpanElement => Boolean(fill),
    )

    if (fills.length === 0) return

    const remembered = firstRunRef.current && chartMemory.has(chartSignature)
    firstRunRef.current = false
    chartMemory.add(chartSignature)

    if (remembered || reduceMotion) {
      fills.forEach((fill, index) => {
        const ratio = Math.max(0.035, data.values[index] / domainMax)
        gsap.set(fill, { scaleY: ratio })
      })
      return
    }

    const tweens = fills.map((fill, index) => {
      const ratio = Math.max(0.035, data.values[index] / domainMax)

      return gsap.to(fill, {
        scaleY: ratio,
        duration: 0.92,
        delay: index * 0.032,
        ease: 'power3.out',
        overwrite: true,
      })
    })

    return () => {
      tweens.forEach((tween) => tween.kill())
    }
  }, [chartSignature, data.values, domainMax, reduceMotion])

  return (
    <div
      className={`trend-chart ${large ? 'trend-chart--large' : ''}`}
      aria-label={`知识调用趋势图：${accessibilityLabel}`}
      role="img"
    >
      <div className="trend-chart__plot">
        <div className="trend-chart__grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <motion.div
          className="trend-chart__target"
          aria-hidden="true"
          initial={false}
          animate={{ bottom: `${targetPercent}%` }}
          transition={{ duration: 0.75, ease: [0.22, 0.8, 0.28, 1] }}
        >
          <span>目标 {formatNumber(data.target)}</span>
        </motion.div>

        <div className="trend-chart__bars">
          {data.values.map((value, index) => {
            const ratio = Math.max(0.035, value / domainMax)
            const isPeak = value === peakValue
            const isHovered = hoveredIndex === index

            return (
              <div
                key={`bar-${index}`}
                className={`trend-chart__column ${
                  isHovered ? 'is-hovered' : ''
                } ${isPeak ? 'is-peak' : ''}`}
                onPointerEnter={() => setHoveredIndex(index)}
                onPointerLeave={() => setHoveredIndex(null)}
              >
                <div className="trend-chart__bar-wrap">
                  <span className="trend-chart__track" aria-hidden="true" />
                  <span
                    ref={(node) => {
                      fillRefs.current[index] = node
                    }}
                    className="trend-chart__fill"
                    style={{ transform: `scaleY(${reduceMotion ? ratio : 0})` }}
                    aria-hidden="true"
                  />
                  <span
                    className={`trend-chart__tooltip ${
                      isHovered ? 'is-visible' : ''
                    }`}
                    style={{ bottom: `${Math.min(94, ratio * 100)}%` }}
                    aria-hidden="true"
                  >
                    <strong>{formatNumber(value)}</strong>
                    <small>{data.labels[index]}</small>
                  </span>
                </div>
                <span className="trend-chart__label">
                  {data.labels[index]}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <ul className="dashboard-sr-only">
        {data.labels.map((label, index) => (
          <li key={label}>
            {label}：{formatNumber(data.values[index])} 次
          </li>
        ))}
      </ul>
    </div>
  )
}
