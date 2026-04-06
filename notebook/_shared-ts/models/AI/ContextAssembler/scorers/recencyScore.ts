import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { parseDateFromDayPath } from '#shared/nbfs/mod.ts'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const ENTITY_TYPES: ReadonlySet<CollectionEntityType> = new Set([
  'person',
  'org',
  'project',
  'goal',
  'idea',
  'place',
  'decision',
])

/**
 * Linear recency score (0–5) decaying over `horizonDays`.
 * Items older than the horizon get 0. Entity types with no date in their
 * path default to 3 (mid-range).
 */
export function recencyScore(item: CollectionItem<Document>, todayMs: number, horizonDays: number): number {
  try {
    const date = parseDateFromDayPath(item.path)
    const daysSince = Math.floor((todayMs - date.toDate().getTime()) / MS_PER_DAY)
    return Math.max(0, 5 * (1 - daysSince / horizonDays))
  } catch {
    return ENTITY_TYPES.has(item.type) ? 3 : 0
  }
}
