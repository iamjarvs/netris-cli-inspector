import { useMemo } from 'react'
import { useFitMonoFontSize } from '../hooks/useFitMonoFontSize'
import EmptyState from './ui/EmptyState'

function cellClasses(type, side) {
  if (side === 'left' && (type === 'delete' || type === 'replace')) return 'bg-error-50 text-error-600'
  if (side === 'right' && (type === 'insert' || type === 'replace')) return 'bg-success-50 text-success-600'
  return 'text-gray-600'
}

export default function SideBySideDiffView({ rows, leftLabel, rightLabel }) {
  const cleaned = rows ?? []

  const allText = useMemo(
    () => cleaned.map((r) => `${r.left ?? ''}\n${r.right ?? ''}`).join('\n'),
    [cleaned]
  )
  const [containerRef, fontSize] = useFitMonoFontSize(allText, { widthDivisor: 2, minSize: 7, maxSize: 12 })

  if (cleaned.length === 0 || cleaned.every((r) => r.type === 'equal')) {
    return <EmptyState message="No differences." />
  }

  return (
    <div ref={containerRef} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {(leftLabel || rightLabel) && (
        <div className="flex border-b border-gray-200 text-theme-xs font-medium">
          <div className="w-1/2 truncate bg-error-50 px-3 py-2 text-error-700">{leftLabel}</div>
          <div className="w-1/2 truncate border-l border-gray-200 bg-success-50 px-3 py-2 text-success-700">{rightLabel}</div>
        </div>
      )}
      <table className="w-full table-fixed border-collapse font-mono leading-5" style={{ fontSize: `${fontSize}px` }}>
        <tbody>
          {cleaned.map((row, i) => (
            <tr key={i} className="align-top">
              <td className={`w-1/2 overflow-hidden whitespace-pre px-3 py-0.5 ${cellClasses(row.type, 'left')}`}>{row.left ?? ''}</td>
              <td className={`w-1/2 overflow-hidden whitespace-pre border-l border-gray-100 px-3 py-0.5 ${cellClasses(row.type, 'right')}`}>
                {row.right ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
