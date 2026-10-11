// All timestamps in the dashboard are shown in the *browser's* time zone.
// The switches (and the git archive's commit messages) use their own zones
// or UTC, which is hard to read against the clock on the wall, so every
// value is parsed and re-rendered locally; the original string is kept for
// tooltips so nothing is lost.

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
})

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
})

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return ''
  }
}

export function parseTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)
  if (typeof value !== 'string' || !value) return null
  // An ISO timestamp with no zone is ambiguous; leave it alone rather than guess.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value)) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatLocal(value) {
  const d = parseTime(value)
  return d ? dateFormat.format(d) : typeof value === 'string' ? value : ''
}

export function formatClock(date) {
  return clockFormat.format(date)
}

export function formatRelative(value, now = Date.now()) {
  const d = parseTime(value)
  if (!d) return ''
  const seconds = Math.round((now - d.getTime()) / 1000)
  if (seconds < 0) return 'in the future'
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Archive commit subjects look like "intent: leaf-01 @ 2026-10-11T16:45:07+00:00".
// The time is shown separately in local time, so drop it from the subject.
export function shortSubject(subject) {
  return (subject || '').replace(/ @ \S+$/, '')
}

// Replaces any ISO timestamps embedded in free text (e.g. archive commit
// subjects, which carry a UTC time) with their local equivalent.
export function localizeText(text) {
  if (!text) return text
  return text.replace(ISO_RE, (match) => {
    const d = parseTime(match)
    return d ? dateFormat.format(d) : match
  })
}
