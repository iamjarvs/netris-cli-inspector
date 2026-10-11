import StructuredViewer from './StructuredViewer'
import Badge from './ui/Badge'

// `filename` is the base name used when the output is downloaded.
export default function ResultPanel({ title, result, filename }) {
  const { ok, stdout, stderr, exit_status: exitStatus, error } = result ?? {}

  if (!result) return null

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <span className="text-theme-sm font-medium text-gray-800">{title}</span>
        <div className="flex items-center gap-2">
          {exitStatus !== null && exitStatus !== undefined && (
            <Badge color="gray">exit {exitStatus}</Badge>
          )}
          <Badge color={ok ? 'success' : 'error'}>{ok ? 'ok' : 'failed'}</Badge>
        </div>
      </div>
      <div className="p-4">
        {!ok && (
          <p className="mb-3 whitespace-pre-wrap text-theme-sm text-error-600">{error || stderr || 'Command failed with no error message.'}</p>
        )}
        <StructuredViewer text={stdout ?? ''} filename={filename ?? title} />
      </div>
    </div>
  )
}
