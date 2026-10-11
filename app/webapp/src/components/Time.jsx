import { useNow } from '../hooks/useNow'
import { formatLocal, formatRelative, parseTime } from '../lib/time'

// Renders a timestamp in the browser's time zone, with a relative "x ago"
// hint. The original (switch / UTC) string is kept in the tooltip.
export default function Time({ value, relative = true, className = '' }) {
  const now = useNow()
  if (!value) return null
  const valid = parseTime(value) !== null
  return (
    <span className={className} title={valid ? `As reported: ${value}` : undefined}>
      {formatLocal(value)}
      {relative && valid && <span className="ml-1.5 text-theme-xs text-gray-400">{formatRelative(value, now)}</span>}
    </span>
  )
}
