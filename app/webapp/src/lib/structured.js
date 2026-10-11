// Parsing, searching and serialising JSON / YAML for the StructuredViewer.
//
// Anything the tool shows -- the Netris intent (YAML), a configuration tree
// (JSON), command output -- goes through parseStructured(). Output that is
// neither (an `nv show` table, vtysh text) comes back as 'text' and is shown
// as plain searchable text instead of a tree.

import YAML from 'yaml'

// A YAML parse of a multi-MB blob would freeze the tab.
const MAX_YAML_CHARS = 3_000_000

// Separates path segments. Keys can contain '.', '/', ':' (e.g. "10.0.0.1/32"),
// so none of those are safe as a separator.
export const SEP = '\u001f'

export function isContainer(value) {
  return value !== null && typeof value === 'object'
}

// First meaningful line of a YAML doc: a list item, a doc marker, or `key:`.
const LOOKS_LIKE_YAML = /^(---|-\s+\S|[\w"'./-]+\s*:(\s|$))/

function firstContentLine(text) {
  for (const line of text.split('\n', 50)) {
    const t = line.trim()
    if (t && !t.startsWith('#')) return t
  }
  return ''
}

/** -> { format: 'json' | 'yaml' | 'text', data? } */
export function parseStructured(text) {
  if (typeof text !== 'string' || !text.trim()) return { format: 'text' }
  const trimmed = text.trim()

  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      const data = JSON.parse(trimmed)
      if (isContainer(data)) return { format: 'json', data }
    } catch {
      // not JSON after all -- fall through to YAML / text
    }
  }

  if (text.length <= MAX_YAML_CHARS && LOOKS_LIKE_YAML.test(firstContentLine(text))) {
    try {
      const data = YAML.parse(text)
      if (isContainer(data)) return { format: 'yaml', data }
    } catch {
      // plain text that merely resembles YAML (e.g. a "Summary:" heading)
    }
  }
  return { format: 'text' }
}

export function toJson(data) {
  return JSON.stringify(data, null, 2)
}

export function toYaml(data) {
  return YAML.stringify(data, { lineWidth: 0 })
}

export function entriesOf(value) {
  return Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)
}

export function childPath(parent, key) {
  return parent === '' ? key : `${parent}${SEP}${key}`
}

export function ancestorsOf(path) {
  // "a<SEP>b<SEP>c" -> ["", "a", "a<SEP>b"]
  const out = ['']
  if (path === '') return []
  const parts = path.split(SEP)
  let acc = ''
  for (let i = 0; i < parts.length - 1; i++) {
    acc = childPath(acc, parts[i])
    out.push(acc)
  }
  return out
}

export function countNodes(data) {
  let n = 0
  const walk = (v) => {
    n++
    if (isContainer(v)) for (const [, c] of entriesOf(v)) walk(c)
  }
  walk(data)
  return n
}

/** Paths of every non-empty container at depth >= `depth` (root is depth 0). */
export function containerPathsFromDepth(data, depth) {
  const out = new Set()
  const walk = (v, path, d) => {
    if (!isContainer(v)) return
    const entries = entriesOf(v)
    if (entries.length === 0) return
    if (d >= depth) out.add(path)
    for (const [k, c] of entries) walk(c, childPath(path, k), d + 1)
  }
  walk(data, '', 0)
  return out
}

/** Big documents open collapsed to the top two levels; small ones fully open. */
export function initialCollapsed(data) {
  return countNodes(data) > 1500 ? containerPathsFromDepth(data, 2) : new Set()
}

export function textOf(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/** Tree search: nodes whose key, or scalar value, contains `query` (case-insensitive).
 * Array indexes aren't matched as keys -- searching "1" shouldn't hit every list. */
export function findMatches(data, query) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out = []
  const walk = (v, key, isIndex, path) => {
    const inKey = key !== null && !isIndex && key.toLowerCase().includes(q)
    const container = isContainer(v)
    const inValue = !container && textOf(v).toLowerCase().includes(q)
    if (inKey || inValue) out.push({ path, inKey, inValue })
    if (container) for (const [k, c] of entriesOf(v)) walk(c, k, Array.isArray(v), childPath(path, k))
  }
  walk(data, null, false, '')
  return out
}

/** Splits text into plain strings and match markers for raw-view highlighting. */
export function splitOnMatches(text, query) {
  const q = query.trim()
  if (!q) return { parts: [text], count: 0 }
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts = []
  let from = 0
  let count = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at === -1) break
    if (at > from) parts.push(text.slice(from, at))
    parts.push({ match: text.slice(at, at + needle.length), index: count++ })
    from = at + needle.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return { parts, count }
}

export function downloadText(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(name) {
  return (name || 'data').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'data'
}
