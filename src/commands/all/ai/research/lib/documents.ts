import type { DocumentPage } from '#shared/models/AI/DocumentPages/mod.ts'
import truncate from '#shared/strings/truncate.ts'

function shortenPage(page: DocumentPage, chars: number): DocumentPage {
  const markdown = truncate(page.markdown, chars)
  const end = page.offset + markdown.length
  return {
    ...page,
    markdown,
    ...(end < page.totalChars ? { nextOffset: end } : {}),
    truncated: page.offset > 0 || end < page.totalChars,
  }
}

/** A hard character cap on the serialized pages, including JSON escaping and source metadata. */
export function fitDocumentPages(pages: DocumentPage[], maxChars: number): DocumentPage[] {
  const kept: DocumentPage[] = []
  for (const page of pages) {
    if (JSON.stringify([...kept, page]).length <= maxChars) {
      kept.push(page)
      continue
    }
    if (JSON.stringify([...kept, shortenPage(page, 0)]).length > maxChars) break
    let low = 0
    let high = page.markdown.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (JSON.stringify([...kept, shortenPage(page, mid)]).length <= maxChars) low = mid
      else high = mid - 1
    }
    if (low > 0) kept.push(shortenPage(page, low))
    break
  }
  return kept
}
