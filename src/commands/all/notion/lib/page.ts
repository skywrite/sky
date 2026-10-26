const PAGE_ID = /^[0-9a-f]{32}$/i

/**
 * A link the person can open, for the chat's sources when Notion's answer
 * names none: a link as given, a bare page id as Notion's own link, and
 * nothing for other references.
 */
export function notionLink(target: string): string | undefined {
  const trimmed = target.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const id = trimmed.replace(/-/g, '')
  return PAGE_ID.test(id) ? `https://www.notion.so/${id.toLowerCase()}` : undefined
}
