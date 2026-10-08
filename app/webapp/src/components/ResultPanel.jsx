import { useFitMonoFontSize } from '../hooks/useFitMonoFontSize'
import Badge from './ui/Badge'

export default function ResultPanel({ title, result }) {
  const { ok, stdout, stderr, exit_status: exitStatus, error, pretty } = result ?? {}
  const formatted = pretty ?? stdout
  const [containerRef, fontSize] = useFitMonoFontSize(formatted ?? '', { paddingPx: 32, minSize: 7, maxSize: 12 })

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
      <div ref={containerRef} className="max-h-[480px] overflow-y-auto overflow-x-hidden p-4">
        {!ok && (
          <p className="mb-3 whitespace-pre-wrap text-theme-sm text-error-600">{error || stderr || 'Command failed with no error message.'}</p>
        )}
        {formatted ? (
          <pre className="whitespace-pre font-mono text-gray-700" style={{ fontSize: `${fontSize}px` }}>
            {formatted}
          </pre>
        ) : (
          <p className="text-theme-sm text-gray-500">No output.</p>
        )}
      </div>
    </div>
  )
}
