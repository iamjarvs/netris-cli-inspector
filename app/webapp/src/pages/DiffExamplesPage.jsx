import { useEffect, useMemo, useState } from 'react'
import { deleteSavedDiff, getSavedDiff, getSavedDiffs } from '../api'
import DiffView from '../components/DiffView'
import SideBySideDiffView from '../components/SideBySideDiffView'
import PageBreadcrumb from '../components/layout/PageBreadcrumb'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import LoadingState from '../components/ui/LoadingState'
import Select from '../components/ui/Select'
import ToggleGroup from '../components/ui/ToggleGroup'
import { useSiteContext } from '../context/SiteContext'
import { buildSideBySide } from '../lib/sideBySideDiff'

const DIFF_MODE_OPTIONS = [
  { value: 'inline', label: 'Inline' },
  { value: 'side-by-side', label: 'Side-by-side' },
]

export default function DiffExamplesPage() {
  const { devices } = useSiteContext()
  const [deviceFilter, setDeviceFilter] = useState('')
  const [list, setList] = useState({ loading: true, error: null, items: [] })
  const [selected, setSelected] = useState(null)
  const [diffMode, setDiffMode] = useState('inline')
  const [confirmingId, setConfirmingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setList({ loading: true, error: null, items: [] })
    getSavedDiffs(deviceFilter || undefined)
      .then((data) => !cancelled && setList({ loading: false, error: null, items: data.items ?? [] }))
      .catch((err) => !cancelled && setList({ loading: false, error: err.message, items: [] }))
    return () => {
      cancelled = true
    }
  }, [deviceFilter])

  const sideBySide = useMemo(() => {
    if (!selected?.record) return []
    return buildSideBySide(selected.record.text_a, selected.record.text_b)
  }, [selected?.record])

  async function handleView(item) {
    setDiffMode('inline')
    setSelected({ loading: true, error: null, record: null, meta: item })
    try {
      const record = await getSavedDiff(item.device, item.id)
      setSelected({ loading: false, error: null, record, meta: item })
    } catch (err) {
      setSelected({ loading: false, error: err.message, record: null, meta: item })
    }
  }

  async function handleDelete(item) {
    try {
      await deleteSavedDiff(item.device, item.id)
      setList((s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) }))
      if (selected?.meta?.id === item.id) setSelected(null)
    } catch (err) {
      setList((s) => ({ ...s, error: err.message }))
    } finally {
      setConfirmingId(null)
    }
  }

  return (
    <div>
      <PageBreadcrumb title="Diff Examples" />

      <Card title="Saved diffs" description="Bookmarked comparisons, saved from the History page, for later reference.">
        <div className="mb-4 max-w-xs">
          <Select label="Device" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        {list.loading && <LoadingState label="Loading saved diffs…" />}
        {list.error && <ErrorState message={list.error} />}
        {!list.loading && !list.error && list.items.length === 0 && <EmptyState message="No saved diffs yet." />}
        {!list.loading && !list.error && list.items.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Label</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Device</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Sources</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Saved</th>
                    <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {list.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-4 text-theme-sm font-medium text-gray-800">{item.label}</td>
                      <td className="px-5 py-4 text-theme-sm text-gray-700">{item.device}</td>
                      <td className="px-5 py-4 text-theme-sm text-gray-500">
                        {item.source_a} <span className="text-gray-400">vs</span> {item.source_b}
                      </td>
                      <td className="px-5 py-4 text-theme-sm text-gray-500">{new Date(item.timestamp).toLocaleString()}</td>
                      <td className="px-5 py-4 text-theme-sm">
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleView(item)}>
                            View
                          </Button>
                          {confirmingId === item.id ? (
                            <Button variant="outline" size="sm" onClick={() => handleDelete(item)}>
                              Confirm delete
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setConfirmingId(item.id)}>
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <div className="h-6" />

      {selected && (
        <Card
          title={selected.meta.label}
          description={selected.record ? `${selected.record.source_a} vs ${selected.record.source_b}` : undefined}
          action={
            selected.record && <ToggleGroup options={DIFF_MODE_OPTIONS} value={diffMode} onChange={setDiffMode} />
          }
        >
          {selected.loading && <LoadingState label="Loading diff…" />}
          {selected.error && <ErrorState message={selected.error} />}
          {selected.record &&
            (diffMode === 'inline' ? (
              <DiffView lines={(selected.record.diff || '').split('\n')} />
            ) : (
              <SideBySideDiffView rows={sideBySide} leftLabel={selected.record.source_a} rightLabel={selected.record.source_b} />
            ))}
        </Card>
      )}
    </div>
  )
}
