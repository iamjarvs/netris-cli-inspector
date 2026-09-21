import { diffLines } from 'diff'

function splitLines(value) {
  const lines = value.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

// Reconstructs a row-aligned two-column diff (equal/replace/delete/insert),
// the same shape the backend's diff_utils.side_by_side returns, from two
// full texts. Used only where the backend didn't precompute one (saved
// diffs only persist "diff"/"text_a"/"text_b", not side_by_side).
export function buildSideBySide(textA, textB) {
  const parts = diffLines(textA ?? '', textB ?? '')
  const rows = []
  let i = 0

  while (i < parts.length) {
    const part = parts[i]

    if (!part.added && !part.removed) {
      for (const line of splitLines(part.value)) rows.push({ type: 'equal', left: line, right: line })
      i += 1
      continue
    }

    if (part.removed) {
      const removedLines = splitLines(part.value)
      const next = parts[i + 1]
      if (next && next.added) {
        const addedLines = splitLines(next.value)
        const max = Math.max(removedLines.length, addedLines.length)
        for (let j = 0; j < max; j++) {
          rows.push({
            type: 'replace',
            left: j < removedLines.length ? removedLines[j] : null,
            right: j < addedLines.length ? addedLines[j] : null,
          })
        }
        i += 2
        continue
      }
      for (const line of removedLines) rows.push({ type: 'delete', left: line, right: null })
      i += 1
      continue
    }

    for (const line of splitLines(part.value)) rows.push({ type: 'insert', left: null, right: line })
    i += 1
  }

  return rows
}
