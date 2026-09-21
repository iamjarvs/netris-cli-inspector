import { useFitMonoFontSize } from '../hooks/useFitMonoFontSize'

/** A <pre> block whose font size shrinks to keep its longest line on one
 * line -- no wrap, no horizontal scroll. `widthDivisor` accounts for a
 * multi-column layout (e.g. 2 for a side-by-side grid) sharing one width.
 */
export default function FitPre({ text, widthDivisor = 1 }) {
  const [containerRef, fontSize] = useFitMonoFontSize(text ?? '', { widthDivisor, paddingPx: 24, minSize: 7, maxSize: 12 })
  return (
    <div ref={containerRef} className="max-h-[560px] overflow-y-auto overflow-x-hidden rounded-xl border border-gray-200 bg-white p-3">
      <pre className="whitespace-pre font-mono text-gray-700" style={{ fontSize: `${fontSize}px` }}>
        {text}
      </pre>
    </div>
  )
}
