/**
 * One page of a long read for a chat: the read tools hand a model at most
 * READ_LIMIT_CHARS at a time, and a cut page says where to continue.
 */

export const READ_LIMIT_CHARS = 40_000

export interface ReadPage {
  content: string
  /** Clamped offset the page actually starts at. */
  start: number
  /** One past the last content char returned (the next page's offset). */
  end: number
  /** True when the page reaches the end of the file. */
  complete: boolean
}

/**
 * Slice one read page out of an export. A truncated page carries a
 * self-directing continuation marker so the model knows there is more and
 * exactly how to get it. Returns null for an offset past the end.
 */
export function paginateRead(full: string, offset = 0, version?: string): ReadPage | null {
  const start = Math.max(0, Math.floor(offset))
  if (start > 0 && start >= full.length) return null
  const end = Math.min(full.length, start + READ_LIMIT_CHARS)
  const complete = end >= full.length
  const body = full.slice(start, end)
  return {
    content: complete
      ? body
      : `${body}\n\n[Truncated — ${full.length} chars total; continue with offset: ${end}${version ? `, version: ${version}` : ''}]`,
    start,
    end,
    complete,
  }
}
