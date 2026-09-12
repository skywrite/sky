import truncate from '#shared/strings/truncate.ts'

export const DOC_MAX_CHARS = 24_000

export interface DocumentPage {
  path: string
  markdown: string
  offset: number
  totalChars: number
  nextOffset?: number
  truncated: boolean
}

/** Offsets refer to the original file, including frontmatter, and never split an emoji. */
export function documentPage(path: string, markdown: string, offset = 0): DocumentPage {
  let start = Math.min(Math.max(0, Math.floor(offset)), markdown.length)
  const first = markdown.charCodeAt(start)
  if (first >= 0xdc00 && first <= 0xdfff) start--
  const text = truncate(markdown.slice(start), DOC_MAX_CHARS)
  const end = start + text.length
  return {
    path,
    markdown: text,
    offset: start,
    totalChars: markdown.length,
    ...(end < markdown.length ? { nextOffset: end } : {}),
    truncated: start > 0 || end < markdown.length,
  }
}

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
