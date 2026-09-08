/**
 * How well a candidate answers a query: 0 exact, 1 prefix, 2 a word's prefix, 3 substring,
 * 4 the letters in order; null when it does not match. An empty query matches everything.
 */
export function matchScore(query: string, candidate: string): number | null {
  const q = normalizeMatchText(query)
  if (q.length === 0) return 3
  const c = normalizeMatchText(candidate)
  if (c === q) return 0
  if (c.startsWith(q)) return 1
  if (c.split(/[\s\-_/.,()]+/).some((word) => word.startsWith(q))) return 2
  if (c.includes(q)) return 3
  let i = 0
  for (const ch of c) if (ch === q[i]) i++
  return i === q.length ? 4 : null
}

/** Read dashes, underscores and runs of spaces as one space. */
export function normalizeMatchText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
}
