export interface JournalDocument {
  path: string
  title: string
  content: string
}
export interface JournalExcerpt extends JournalDocument {
  excerpt: string
}

/** The CLI gather is intentionally uncapped. A browser session needs a bounded model request. */
export function journalExcerpts(documents: JournalDocument[], budget = 160_000, perDocument = 8000): JournalExcerpt[] {
  const omitted = '\n\n[Middle of document omitted for length.]\n\n'
  const indices = [...new Set([...documents.slice(0, 8).map((_, i) => i), ...documents.map((_, i) => i).reverse()])]
  const chosen = new Map<number, JournalExcerpt>()
  for (const index of indices) {
    const doc = documents[index]
    if (!doc.content.trim()) continue
    const size = Math.min(perDocument, budget)
    if (size < omitted.length + 100) break
    let excerpt = doc.content
    if (excerpt.length > size) {
      const available = size - omitted.length
      const head = Math.ceil(available * 0.6)
      excerpt = `${excerpt.slice(0, head)}${omitted}${excerpt.slice(-(available - head))}`
    }
    chosen.set(index, { ...doc, excerpt })
    budget -= excerpt.length
  }
  // Keep the gather's chronological order; citation IDs address this bounded set.
  return [...chosen.entries()].sort(([a], [b]) => a - b).map(([, doc]) => doc)
}
