function isExpandable(value) {
  return value !== null && typeof value === 'object'
}

function scalarText(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function childPath(path, key) {
  return path ? `${path}.${key}` : key
}

function Toggle({ collapsed }) {
  return <span className="mr-1 inline-block w-3 text-gray-400">{collapsed ? '▸' : '▾'}</span>
}

function Node({ label, value, path, collapsedPaths, onToggle }) {
  if (!isExpandable(value)) {
    return (
      <div className="whitespace-pre-wrap break-all font-mono text-theme-xs text-gray-700">
        {label !== null && <span className="text-gray-500">{label}: </span>}
        <span>{scalarText(value)}</span>
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value)
  const openBrace = isArray ? '[' : '{'
  const closeBrace = isArray ? ']' : '}'
  const prefix = label !== null ? `${label}: ` : ''

  if (entries.length === 0) {
    return (
      <div className="whitespace-pre font-mono text-theme-xs text-gray-700">
        {prefix}
        {openBrace}
        {closeBrace}
      </div>
    )
  }

  const collapsed = collapsedPaths.has(path)

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onToggle(path)}
        className="block w-full whitespace-pre text-left font-mono text-theme-xs text-gray-700 hover:bg-gray-50"
      >
        <Toggle collapsed />
        {prefix}
        {openBrace} … {closeBrace}
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(path)}
        className="block w-full whitespace-pre text-left font-mono text-theme-xs text-gray-700 hover:bg-gray-50"
      >
        <Toggle collapsed={false} />
        {prefix}
        {openBrace}
      </button>
      <div className="ml-3 border-l border-gray-100 pl-3">
        {entries.map(([key, val]) => (
          <Node
            key={key}
            label={isArray ? null : key}
            value={val}
            path={childPath(path, key)}
            collapsedPaths={collapsedPaths}
            onToggle={onToggle}
          />
        ))}
      </div>
      <div className="whitespace-pre pl-4 font-mono text-theme-xs text-gray-700">{closeBrace}</div>
    </div>
  )
}

export default function ConfigTree({ data, collapsedPaths, onToggle }) {
  return <Node label={null} value={data} path="" collapsedPaths={collapsedPaths} onToggle={onToggle} />
}
