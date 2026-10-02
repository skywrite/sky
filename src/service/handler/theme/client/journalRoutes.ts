export interface JournalRoute {
  day: string
  topic: string | null
}
export function journalRouteOf(path: string): JournalRoute | null {
  const match = path.match(/^\/(\d{4}-\d{2}-\d{2})\/journal(?:\/([a-z0-9-]+))?\/?$/)
  return match ? { day: match[1], topic: match[2] ?? null } : null
}
export const journalHref = (day: string, topic?: string): string =>
  `/${day}/journal${topic ? `/${encodeURIComponent(topic)}` : ''}`
