import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { parseTimePath } from '#shared/nbfs/mod.ts'

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
 * Age is measured from the end of the document's time-tree span, so a
 * week-level doc (the week plan) stays today-fresh until its week ends and
 * only then starts aging; day docs are one-day spans and age as before.
 * Items older than the horizon get 0. Entity types with no date in their
 * path default to 3 (mid-range).
 */
export function recencyScore(item: CollectionItem<Document>, todayMs: number, horizonDays: number): number {
  const info = parseTimePath(item.path)
  if (!info) return ENTITY_TYPES.has(item.type) ? 3 : 0
  const daysSince = Math.max(0, Math.floor((todayMs - info.end.toDate().getTime()) / MS_PER_DAY))
  return Math.max(0, 5 * (1 - daysSince / horizonDays))
}
