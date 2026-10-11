import { formatLocal, shortSubject } from '../../lib/time'

export const FIXED_SOURCES = [
  { type: 'onbox', ref: 'applied', label: 'Current (applied)', desc: 'current (applied)' },
  { type: 'onbox', ref: 'startup', label: 'Startup (current on-box)', desc: 'startup (current on-box)' },
  { type: 'onbox', ref: 'pending', label: 'Pending', desc: 'pending' },
  { type: 'onbox', ref: 'operational', label: 'Operational', desc: 'operational' },
]

// The switch keeps exactly one copy of the Netris intent file (what it holds
// right now), so "live" is the only on-box source for intent; everything
// older comes from the archive.
export const INTENT_FIXED_SOURCES = [
  { type: 'onbox', ref: 'live', label: 'Live intent (current on switch)', desc: 'live intent (current on switch)' },
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
      label: `${r.rev_id} — ${formatLocal(r.apply_date)} (${r.user})${r.pruned ? '  [pruned]' : ''}`,
    }))
}

export function archiveSnapshotOptions(entries) {
  return (entries ?? []).map((e) => ({
    type: 'archive',
    ref: e.commit,
    label: `${e.commit.slice(0, 7)} — ${formatLocal(e.date)} — ${shortSubject(e.subject)}`,
  }))
}

export function describeSource(source) {
  if (!source) return ''
  if (source.type === 'onbox') {
    const fixed = [...FIXED_SOURCES, ...INTENT_FIXED_SOURCES].find((f) => f.ref === source.ref)
    if (fixed) return fixed.desc
    return `on-box rev ${source.ref}`
  }
  if (source.type === 'archive') return `archive ${source.ref.slice(0, 7)}`
  return source.ref
}
