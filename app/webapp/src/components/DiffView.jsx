import { useMemo } from 'react'
import { useFitMonoFontSize } from '../hooks/useFitMonoFontSize'
import EmptyState from './ui/EmptyState'

function lineClasses(line) {
  if (line.startsWith('@@')) return 'text-info-600 bg-info-50'
  if (line.startsWith('+')) return 'text-success-600 bg-success-50'
  if (line.startsWith('-')) return 'text-error-600 bg-error-50'
  return 'text-gray-500'
}

export default function DiffView({ lines }) {
  const cleaned = (lines ?? []).filter((line) => line !== '')
  const joined = useMemo(() => cleaned.join('\n'), [cleaned])
  const [containerRef, fontSize] = useFitMonoFontSize(joined, { paddingPx: 32, minSize: 7, maxSize: 12 })

  if (cleaned.length === 0) {
    return <EmptyState message="No differences." />
  }

  return (
    <div ref={containerRef} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <pre className="font-mono leading-5" style={{ fontSize: `${fontSize}px` }}>
        {cleaned.map((line, i) => (
          <div key={i} className={`overflow-hidden whitespace-pre px-4 py-0.5 ${lineClasses(line)}`}>
            {line}
          </div>
        ))}
      </pre>
    </div>
  )
}
