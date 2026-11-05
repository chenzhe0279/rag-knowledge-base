import { motion, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { useEffect, useId } from 'react'

function formatAnimated(value: number, digits: number) {
  if (digits === 0) return Math.round(value).toLocaleString('zh-CN')
  return value.toFixed(digits)
}

/** 数字平滑过渡到新值；读屏只读最终值。 */
export function AnimatedNumber({ value, digits = 0 }: { value: number; digits?: number }) {
  const reduceMotion = useReducedMotion()
  const spring = useSpring(value, { stiffness: 90, damping: 22 })
  const text = useTransform(spring, (current) => formatAnimated(current, digits))

  useEffect(() => {
    if (reduceMotion) spring.jump(value)
    else spring.set(value)
  }, [spring, value, reduceMotion])

  return (
    <>
      <motion.span aria-hidden="true">{text}</motion.span>
      <span className="sr-only">{formatAnimated(value, digits)}</span>
    </>
  )
}

function buildPoints(values: number[], width: number, height: number, inset = 3) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values.map((value, index) => ({
    x: index * step,
    y: inset + (1 - (value - min) / span) * (height - inset * 2),
  }))
}

function linePath(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
}

function svgId(raw: string) {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '')
}

export function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  const gradientId = `spark-${svgId(useId())}`
  const width = 120
  const height = 38
  const points = buildPoints(values, width, height)
  const line = linePath(points)
  const last = points[points.length - 1]

  return (
    <svg
      className="dash-spark"
      data-positive={positive}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last.x} cy={last.y} r="2.4" fill="currentColor" /> : null}
    </svg>
  )
}

/** 知识脉搏：问答量面积 + 命中率折线（双轴，各自归一化）。 */
export function PulseChart({
  queries,
  hitRates,
  labels,
}: {
  queries: number[]
  hitRates: number[]
  labels: string[]
}) {
  const gradientId = `pulse-${svgId(useId())}`
  const width = 600
  const height = 180
  const queryPoints = buildPoints(queries, width, height, 14)
  const hitPoints = buildPoints(hitRates, width, height, 28)
  const queryLine = linePath(queryPoints)

  return (
    <div className="dash-pulse">
      <svg
        className="dash-pulse__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b66d44" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#b66d44" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1="0"
            x2={width}
            y1={height * ratio}
            y2={height * ratio}
            className="dash-pulse__grid"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={`${queryLine} L${width} ${height} L0 ${height} Z`} fill={`url(#${gradientId})`} />
        <path
          d={queryLine}
          className="dash-pulse__queries"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={linePath(hitPoints)}
          className="dash-pulse__hits"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="dash-pulse__labels" aria-hidden="true">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}
