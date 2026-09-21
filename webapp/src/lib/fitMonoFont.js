const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'

let measureCanvas = null

function measureTextWidth(text, fontSizePx) {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  ctx.font = `${fontSizePx}px ${MONO_FONT_STACK}`
  return ctx.measureText(text).width
}

function longestLine(text) {
  let longest = ''
  for (const line of text.split('\n')) {
    if (line.length > longest.length) longest = line
  }
  return longest
}

/**
 * Computes the largest font size (in px) at which the longest line of
 * `text` fits within `containerWidthPx` on one line -- monospace tables
 * (nv show output, diffs) lose their column alignment the moment a line
 * wraps, so shrinking to fit beats wrapping or horizontal scroll.
 */
export function computeFitFontSize({
  text,
  containerWidthPx,
  minSize = 7,
  maxSize = 12,
  paddingPx = 24,
}) {
  if (!text || !containerWidthPx) return maxSize
  const longest = longestLine(text)
  if (!longest) return maxSize

  const refSize = 100
  const widthAtRef = measureTextWidth(longest, refSize)
  if (widthAtRef === 0) return maxSize

  const available = Math.max(containerWidthPx - paddingPx, 10)
  const fitSize = (available / widthAtRef) * refSize
  return Math.min(maxSize, Math.max(minSize, Math.floor(fitSize)))
}

export { MONO_FONT_STACK }
