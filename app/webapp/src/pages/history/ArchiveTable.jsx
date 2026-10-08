import { useState } from 'react'
import { getConfigSource } from '../../api'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import LoadingState from '../../components/ui/LoadingState'

export default function ArchiveTable({ state, device, mgmtAddress, onCompare }) {
  const { loading, error, data } = state
  const [expanded, setExpanded] = useState({ loading: false, error: null, commit: null, content: null })

  async function handleView(commit) {
    setExpanded({ loading: true, error: null, commit, content: null })
    try {
      const res = await getConfigSource({ device, mgmtAddress, sourceType: 'archive', ref: commit, format: 'text' })
      setExpanded({ loading: false, error: null, commit, content: res.text })
    } catch (err) {
      setExpanded({ loading: false, error: err.message, commit, content: null })
    }
  }

  if (loading) return <LoadingState label="Loading archive history…" />
  if (error) return <ErrorState message={error} />

  const entries = data?.entries ?? []
  if (entries.length === 0) return <EmptyState message="No archive snapshots found." />

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="max-w-full overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Commit</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Date</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Subject</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {entries.map((entry) => (
                <tr key={entry.commit}>
                  <td className="px-5 py-4 font-mono text-theme-xs text-gray-700">{entry.commit.slice(0, 10)}</td>
                  <td className="px-5 py-4 text-theme-sm text-gray-700">{entry.date}</td>
                  <td className="px-5 py-4 text-theme-sm text-gray-700">{entry.subject}</td>
                  <td className="px-5 py-4 text-theme-sm">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleView(entry.commit)}>
                        View
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => onCompare({ type: 'archive', ref: entry.commit })}>
                        Compare vs current
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {expanded.commit && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 font-mono text-theme-xs text-gray-500">{expanded.commit.slice(0, 10)}</p>
          {expanded.loading && <LoadingState label="Loading snapshot content…" />}
          {expanded.error && <ErrorState message={expanded.error} />}
          {!expanded.loading && !expanded.error && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-theme-xs text-gray-700">
              {expanded.content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
