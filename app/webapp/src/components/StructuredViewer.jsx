import { useEffect, useMemo, useRef, useState } from 'react'
import { useFitMonoFontSize } from '../hooks/useFitMonoFontSize'
import {
  ancestorsOf,
  childPath,
  containerPathsFromDepth,
  countNodes,
  downloadText,
  entriesOf,
  findMatches,
  initialCollapsed,
  isContainer,
  parseStructured,
  safeFilename,
  splitOnMatches,
  textOf,
  toJson,
  toYaml,
} from '../lib/structured'
import ToggleGroup from './ui/ToggleGroup'

const FORMAT_LABEL = { json: 'JSON', yaml: 'YAML', text: 'Text' }
const FORMAT_EXT = { json: 'json', yaml: 'yaml', text: 'txt' }
const LEVEL_OPTIONS = [1, 2, 3, 4, 5]

// ---------------------------------------------------------------------------
// Small pieces

function Highlight({ text, query }) {
  const q = query.trim().toLowerCase()
  if (!q) return text
  const lower = text.toLowerCase()
  const out = []
  let from = 0
  for (;;) {
    const at = lower.indexOf(q, from)
    if (at === -1) break
    if (at > from) out.push(text.slice(from, at))
    out.push(
      <mark key={at} className="rounded-sm bg-warning-50 px-0.5 text-gray-900 ring-1 ring-warning-500/40">
        {text.slice(at, at + q.length)}
      </mark>,
    )
    from = at + q.length
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

function ToolButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-md px-2.5 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

function valueClass(value) {
  if (typeof value === 'number') return 'text-info-600'
  if (typeof value === 'boolean' || value === null) return 'text-warning-600'
  return 'text-gray-800'
}

// ---------------------------------------------------------------------------
// Tree

function TreeNode({ label, isIndex, value, path, ctx }) {
  const { collapsed, onToggle, query, matchIndex, currentIndex } = ctx
  const matchIdx = matchIndex.get(path)
  const isMatch = matchIdx !== undefined
  const isCurrent = isMatch && matchIdx === currentIndex
  const rowMark = isCurrent ? 'bg-warning-50 ring-1 ring-warning-500/50 rounded' : ''
  const dataAttrs = isMatch ? { 'data-match': matchIdx, 'data-current': isCurrent ? 'true' : undefined } : {}

  const labelNode =
    label === null ? null : (
      <span className="text-gray-500">
        {isIndex ? '–' : <Highlight text={label} query={query} />}
        {isIndex ? ' ' : ': '}
      </span>
    )

  if (!isContainer(value)) {
    const shown = typeof value === 'string' && value === '' ? '""' : textOf(value)
    return (
      <div {...dataAttrs} className={`whitespace-pre-wrap break-all font-mono text-theme-xs ${rowMark}`}>
        {labelNode}
        <span className={valueClass(value)}>
          <Highlight text={shown} query={query} />
        </span>
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries = entriesOf(value)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'

  if (entries.length === 0) {
    return (
      <div {...dataAttrs} className={`font-mono text-theme-xs text-gray-700 ${rowMark}`}>
        {labelNode}
        {open}
        {close}
      </div>
    )
  }

  const isCollapsed = collapsed.has(path)
  const header = (
    <button
      type="button"
      onClick={() => onToggle(path)}
      {...dataAttrs}
      className={`block w-full whitespace-pre text-left font-mono text-theme-xs text-gray-700 hover:bg-gray-50 ${rowMark}`}
    >
      <span className="mr-1 inline-block w-3 text-gray-400">{isCollapsed ? '▸' : '▾'}</span>
      {labelNode}
      {open}
      {isCollapsed && (
        <span className="text-gray-400">
          {' '}
          … {entries.length} {entries.length === 1 ? 'item' : 'items'} {close}
        </span>
      )}
    </button>
  )

  if (isCollapsed) return header

  return (
    <div>
      {header}
      <div className="ml-3 border-l border-gray-100 pl-3">
        {entries.map(([key, child]) => (
          <TreeNode key={key} label={key} isIndex={isArray} value={child} path={childPath(path, key)} ctx={ctx} />
        ))}
      </div>
      <div className="whitespace-pre pl-4 font-mono text-theme-xs text-gray-700">{close}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Download menu

function DownloadMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <ToolButton onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        Download ▾
      </ToolButton>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-theme-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-theme-xs text-gray-700 hover:bg-gray-50"
              onClick={() => {
                item.onSelect()
                setOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Viewer

/**
 * Search / collapse / convert / download viewer for JSON, YAML or plain text.
 *
 *  - `text`: any string. JSON and YAML are detected and shown as a collapsible
 *    tree; anything else (nv show tables, vtysh output) is shown as plain,
 *    searchable text.
 *  - `data`: an already-parsed object/array, shown as a tree (and offered as
 *    JSON or YAML).
 *  - `filename`: base name for downloads (extension is added).
 */
export default function StructuredViewer({ text, data: dataProp, filename = 'data', maxHeight = 480 }) {
  const parsed = useMemo(
    () => (dataProp !== undefined ? { format: 'json', data: dataProp } : parseStructured(text)),
    [text, dataProp],
  )
  const { format, data } = parsed
  const structured = format !== 'text'

  // Everything that must reset when the content changes lives in one object,
  // reset during render (React's documented "adjust state on prop change").
  const freshState = () => ({
    data,
    mode: structured ? 'tree' : 'text',
    collapsed: structured ? initialCollapsed(data) : new Set(),
    query: '',
    activeQuery: '',
    current: 0,
  })
  const [state, setState] = useState(freshState)
  if (state.data !== data || (state.mode === 'text') === structured) setState(freshState())
  const { mode, collapsed, query, activeQuery, current } = state
  const patch = (p) => setState((s) => ({ ...s, ...p }))

  const bodyRef = useRef(null)

  // ----- derived views
  const rawText = useMemo(() => {
    if (mode === 'json') return toJson(data)
    if (mode === 'yaml') return format === 'yaml' && typeof text === 'string' ? text : toYaml(data)
    return typeof text === 'string' ? text : ''
  }, [mode, data, format, text])

  const nodeCount = useMemo(() => (structured ? countNodes(data) : 0), [structured, data])
  const treeMatches = useMemo(
    () => (mode === 'tree' ? findMatches(data, activeQuery) : []),
    [mode, data, activeQuery],
  )
  const matchIndex = useMemo(() => new Map(treeMatches.map((m, i) => [m.path, i])), [treeMatches])
  const raw = useMemo(
    () => (mode === 'tree' ? { parts: [], count: 0 } : splitOnMatches(rawText, activeQuery)),
    [mode, rawText, activeQuery],
  )
  const matchCount = mode === 'tree' ? treeMatches.length : raw.count
  const currentClamped = matchCount ? Math.min(current, matchCount - 1) : 0

  const [fitRef, fitFont] = useFitMonoFontSize(mode === 'tree' ? '' : rawText, {
    paddingPx: 32,
    minSize: 7,
    maxSize: 12,
  })

  // Debounce typing: expensive searches run once the user pauses.
  useEffect(() => {
    if (query === activeQuery) return
    const t = setTimeout(() => {
      setState((s) => {
        let nextCollapsed = s.collapsed
        if (s.mode === 'tree' && query.trim()) {
          // Reveal every match by opening the branches that hide it.
          nextCollapsed = new Set(s.collapsed)
          for (const m of findMatches(s.data, query)) for (const a of ancestorsOf(m.path)) nextCollapsed.delete(a)
        }
        return { ...s, activeQuery: query, current: 0, collapsed: nextCollapsed }
      })
    }, 180)
    return () => clearTimeout(t)
  }, [query, activeQuery])

  // Bring the current match into view (scrolls only the viewer, not the page).
  useEffect(() => {
    const body = bodyRef.current
    if (!body || !activeQuery.trim()) return
    const el = body.querySelector('[data-current="true"]')
    if (!el) return
    const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    body.scrollTo({ top: Math.max(top - body.clientHeight / 2, 0), behavior: 'auto' })
  }, [currentClamped, activeQuery, mode, matchCount])

  function go(delta) {
    if (!matchCount) return
    const next = (currentClamped + delta + matchCount) % matchCount
    if (mode === 'tree') {
      // The user may have folded the branch since the search ran.
      const nextCollapsed = new Set(collapsed)
      for (const a of ancestorsOf(treeMatches[next].path)) nextCollapsed.delete(a)
      patch({ current: next, collapsed: nextCollapsed })
    } else {
      patch({ current: next })
    }
  }

  function toggle(path) {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    patch({ collapsed: next })
  }

  const [copied, setCopied] = useState(false)
  async function copy() {
    const content = mode === 'tree' ? toJson(data) : rawText
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked (e.g. insecure context) -- nothing useful to do
    }
  }

  const base = safeFilename(filename)
  const downloadItems = []
  if (structured) {
    downloadItems.push({ label: 'As JSON (.json)', onSelect: () => downloadText(`${base}.json`, toJson(data), 'application/json') })
    downloadItems.push({ label: 'As YAML (.yaml)', onSelect: () => downloadText(`${base}.yaml`, toYaml(data), 'text/yaml') })
  }
  if (typeof text === 'string' && text) {
    downloadItems.push({
      label: structured ? `Original (.${FORMAT_EXT[format]})` : 'Text (.txt)',
      onSelect: () => downloadText(`${base}.${FORMAT_EXT[format]}`, text),
    })
  }

  if (!structured && !(typeof text === 'string' && text)) {
    return <p className="text-theme-sm text-gray-500">No output.</p>
  }

  const modeOptions = structured
    ? [
        { value: 'tree', label: 'Tree' },
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
      ]
    : null

  const ctx = { collapsed, onToggle: toggle, query: activeQuery, matchIndex, currentIndex: currentClamped }
  const lineCount = typeof text === 'string' ? text.split('\n').length : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <input
            type="search"
            value={query}
            placeholder="Search keys and values…"
            aria-label="Search"
            onChange={(e) => patch({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') patch({ query: '', activeQuery: '', current: 0 })
            }}
            className="h-8 w-full rounded-md border border-gray-300 bg-transparent px-2.5 text-theme-xs text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/20"
          />
        </div>
        {activeQuery.trim() && (
          <span className="whitespace-nowrap text-theme-xs text-gray-500" aria-live="polite">
            {matchCount ? `${currentClamped + 1} of ${matchCount}` : 'No matches'}
          </span>
        )}
        <ToolButton onClick={() => go(-1)} disabled={!matchCount} aria-label="Previous match" title="Previous (Shift+Enter)">
          ▲
        </ToolButton>
        <ToolButton onClick={() => go(1)} disabled={!matchCount} aria-label="Next match" title="Next (Enter)">
          ▼
        </ToolButton>

        {modeOptions && <ToggleGroup options={modeOptions} value={mode} onChange={(m) => patch({ mode: m, current: 0 })} />}

        {mode === 'tree' && (
          <>
            <ToolButton onClick={() => patch({ collapsed: new Set() })}>Expand all</ToolButton>
            <ToolButton onClick={() => patch({ collapsed: containerPathsFromDepth(data, 0) })}>Collapse all</ToolButton>
            <select
              aria-label="Expand to level"
              value=""
              onChange={(e) => e.target.value && patch({ collapsed: containerPathsFromDepth(data, Number(e.target.value)) })}
              className="h-8 rounded-md border border-gray-300 bg-white px-2 text-theme-xs text-gray-700 focus:border-brand-300 focus:outline-hidden"
            >
              <option value="">Level…</option>
              {LEVEL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Expand to level {n}
                </option>
              ))}
            </select>
          </>
        )}

        <ToolButton onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</ToolButton>
        <DownloadMenu items={downloadItems} />
      </div>

      <p className="text-theme-xs text-gray-400">
        {FORMAT_LABEL[format]}
        {structured && ` · ${nodeCount.toLocaleString()} nodes`}
        {lineCount !== null && ` · ${lineCount.toLocaleString()} lines`}
      </p>

      <div ref={fitRef}>
        <div
          ref={bodyRef}
          className="overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white p-3"
          style={{ maxHeight }}
        >
          {mode === 'tree' ? (
            <TreeNode label={null} isIndex={false} value={data} path="" ctx={ctx} />
          ) : (
            <pre className="whitespace-pre font-mono text-gray-700" style={{ fontSize: `${fitFont}px` }}>
              {raw.parts.map((part, i) =>
                typeof part === 'string' ? (
                  part
                ) : (
                  <mark
                    key={i}
                    data-current={part.index === currentClamped ? 'true' : undefined}
                    className={`rounded-sm px-0.5 text-gray-900 ${
                      part.index === currentClamped ? 'bg-warning-500/40 ring-1 ring-warning-500' : 'bg-warning-50 ring-1 ring-warning-500/30'
                    }`}
                  >
                    {part.match}
                  </mark>
                ),
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
