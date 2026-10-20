interface SpinnerProps {
  label?: string
  small?: boolean
}

export function Spinner({ label = '加载中', small = false }: SpinnerProps) {
  return (
    <span className="spinner-wrap" role="status" aria-label={label}>
      <span className={small ? 'spinner spinner--sm' : 'spinner'} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
