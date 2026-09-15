/**
 * The outbox's two pages: the list at `/outbox`, and one item at
 * `/outbox/<id>`. The id is the item's file name — a readable
 * `2026-09-12_1705_Approve-the-Atlas-pilot-budget` for new items, a
 * 32-character hash for older ones — so the same helpers read and write both.
 */

/** '' for the list, the item's id for its page, null for any other page. */
export function outboxItemOf(pathname: string): string | null {
  if (pathname === '/outbox' || pathname === '/outbox/') return ''
  const match = /^\/outbox\/([^/]+)$/.exec(pathname)
  if (!match) return null
  try {
    const id = decodeURIComponent(match[1]!)
    return id.length > 0 && id !== '_api' ? id : null
  } catch {
    return null
  }
}

/** The page path for an item, or the list when no id is given. */
export function outboxHref(id?: string | null): string {
  return id ? `/outbox/${encodeURIComponent(id)}` : '/outbox'
}

/** The retired `/outbox?item=<id>` link, read back as the item's page path; null when the query names no item. */
export function outboxLegacyItemPath(pathname: string, search: string): string | null {
  if (pathname !== '/outbox' && pathname !== '/outbox/') return null
  const id = new URLSearchParams(search).get('item')
  return id ? outboxHref(id) : null
}
