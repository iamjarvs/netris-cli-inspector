export const FIXED_SOURCES = [
  { type: 'onbox', ref: 'applied', label: 'Current (applied)', desc: 'current (applied)' },
  { type: 'onbox', ref: 'startup', label: 'Startup (current on-box)', desc: 'startup (current on-box)' },
  { type: 'onbox', ref: 'pending', label: 'Pending', desc: 'pending' },
  { type: 'onbox', ref: 'operational', label: 'Operational', desc: 'operational' },
]

export function encodeSource(type, ref) {
  return `${type}:${ref}`
}

export function decodeSource(value) {
  const idx = value.indexOf(':')
  return { type: value.slice(0, idx), ref: value.slice(idx + 1) }
}

export function onboxRevisionOptions(revisions, hideStartup, hidePruned = true) {
  return (revisions ?? [])
    .filter((r) => !(hideStartup && r.rev_id === 'startup'))
    .filter((r) => !(hidePruned && r.pruned))
    .map((r) => ({
      type: 'onbox',
      ref: r.rev_id,
      label: r.pruned ? `${r.rev_id} — ${r.apply_date} (${r.user})  [pruned]` : `${r.rev_id} — ${r.apply_date} (${r.user})`,
    }))
}

function formatArchiveDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function archiveSnapshotOptions(entries) {
  return (entries ?? []).map((e) => ({
    type: 'archive',
    ref: e.commit,
    label: `${e.commit.slice(0, 7)} — ${formatArchiveDate(e.date)} — ${e.subject}`,
  }))
}

export function describeSource(source) {
  if (!source) return ''
  if (source.type === 'onbox') {
    const fixed = FIXED_SOURCES.find((f) => f.ref === source.ref)
    if (fixed) return fixed.desc
    return `on-box rev ${source.ref}`
  }
  if (source.type === 'archive') return `archive ${source.ref.slice(0, 7)}`
  return source.ref
}
