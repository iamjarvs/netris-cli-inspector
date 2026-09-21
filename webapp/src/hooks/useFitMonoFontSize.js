import { useEffect, useRef, useState } from 'react'
import { computeFitFontSize } from '../lib/fitMonoFont'

/**
 * Ref to attach to the container whose width should drive the font size,
 * plus the computed font size in px. Recomputes on resize (sidebar
 * collapse, window resize) and whenever `text` changes.
 */
export function useFitMonoFontSize(text, opts) {
  const ref = useRef(null)
  const [fontSize, setFontSize] = useState(opts?.maxSize ?? 12)
  const widthDivisor = opts?.widthDivisor ?? 1

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const recompute = () => {
      setFontSize(computeFitFontSize({ text, containerWidthPx: el.clientWidth / widthDivisor, ...opts }))
    }
    recompute()

    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return [ref, fontSize]
}
