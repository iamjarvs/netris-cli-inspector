import { useCatalog } from '../context/CatalogContext'
import Badge from './ui/Badge'
import Select from './ui/Select'

export default function CommandPicker({ selectedId, onSelect }) {
  const { config, show, loading, error } = useCatalog()
  const all = [...config, ...show]
  const selectedEntry = all.find((e) => e.id === selectedId)

  return (
    <div>
      <Select
        label="Suggested commands"
        value={selectedId}
        loading={loading}
        disabled={loading}
        onChange={(e) => {
          const entry = all.find((c) => c.id === e.target.value)
          onSelect(entry ?? null)
        }}
      >
        <option value="">{loading ? 'Loading catalog…' : 'Custom command…'}</option>
        {config.length > 0 && (
          <optgroup label="Configuration">
            {config.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </optgroup>
        )}
        {show.length > 0 && (
          <optgroup label="Show">
            {show.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({entry.source})
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      {error && <p className="mt-1.5 text-theme-xs text-error-600">Could not load command catalog: {error}</p>}
      {selectedEntry?.source && (
        <div className="mt-1.5">
          <Badge color={selectedEntry.source === 'vtysh' ? 'warning' : 'gray'}>{selectedEntry.source}</Badge>
        </div>
      )}
    </div>
  )
}
