interface ProgressBarProps {
  /** 0–100；为 null 时显示不确定进度（例如排队中）。 */
  value: number | null
  label: string
  className?: string
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const indeterminate = value === null
  const classes = ['progress', indeterminate ? 'progress--indeterminate' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={classes}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : value}
    >
      <div
        className="progress__bar"
        style={indeterminate ? undefined : { transform: `scaleX(${value / 100})` }}
      />
    </div>
  )
}
