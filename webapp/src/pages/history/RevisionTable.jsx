import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import LoadingState from '../../components/ui/LoadingState'

export default function RevisionTable({ state, hideStartup, hidePruned, onCompare }) {
  const { loading, error, data } = state

  if (loading) return <LoadingState label="Loading on-box history…" />
  if (error) return <ErrorState message={error} />
  if (!data?.ok) return <ErrorState message={data?.error || 'Could not load on-box history.'} />

  const allRevisions = (data.revisions ?? []).filter((r) => !(hideStartup && r.rev_id === 'startup'))
  const prunedCount = allRevisions.filter((r) => r.pruned).length
  const revisions = allRevisions.filter((r) => !(hidePruned && r.pruned))
  if (revisions.length === 0) {
    return (
      <EmptyState
        message={prunedCount > 0 && hidePruned ? `All remaining revisions are pruned (${prunedCount} hidden).` : 'No on-box revisions to show.'}
      />
    )
  }

  return (
    <div>
      {prunedCount > 0 && hidePruned && (
        <p className="mb-3 text-theme-xs text-gray-500">{prunedCount} pruned revision(s) hidden.</p>
      )}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="max-w-full overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Revision</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Applied</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Type</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">User</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Message</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500">Status</th>
                <th className="px-5 py-3 text-start text-theme-xs font-medium text-gray-500" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {revisions.map((rev, index) => (
                <tr key={`${rev.rev_id}-${rev.apply_date}-${index}`}>
                  <td className="px-5 py-4 text-theme-sm font-medium text-gray-800">{rev.rev_id}</td>
                  <td className="px-5 py-4 text-theme-sm text-gray-700">{rev.apply_date}</td>
                  <td className="px-5 py-4 text-theme-sm text-gray-700">{rev.rev_type}</td>
                  <td className="px-5 py-4 text-theme-sm text-gray-700">{rev.user}</td>
                  <td className="px-5 py-4 text-theme-sm text-gray-700">{rev.message}</td>
                  <td className="px-5 py-4 text-theme-sm">
                    {rev.pruned ? <Badge color="warning">pruned</Badge> : <Badge color="success">live</Badge>}
                  </td>
                  <td className="px-5 py-4 text-theme-sm">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rev.pruned}
                      title={rev.pruned ? 'No longer resident on the switch -- compare will fail.' : undefined}
                      onClick={() => onCompare({ type: 'onbox', ref: rev.rev_id })}
                    >
                      Compare vs current
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
