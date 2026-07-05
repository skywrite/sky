import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { Scorer } from '../mod.ts'
import { recencyScore } from './recencyScore.ts'

/**
 * Scorer tuned for journal:new --ai context assembly.
 *
 * Goals/decisions are the north star — always highest priority.
 * Journals next (recent first), then day activity files, then entities.
 * Recency decays over `horizonDays` (default 14 — tight window for daily journaling).
 *
 * Orgs are always pruned (-Infinity) — they never help question generation.
 */

const TYPE_SCORES: Record<CollectionEntityType, number> = {
  goal: 12,
  decision: 12,
  journal: 8,
  day: 5,
  meeting: 5,
  message: 5,
  video: 5,
  chat: 5,
  document: 5,
  project: 3,
  person: 3,
  idea: 2,
  place: 1,
  org: 0, // special-cased to -Infinity below
}

export function createJournalScorer(today: PlainDate, horizonDays = 14): Scorer {
  const todayMs = today.toDate().getTime()

  return (item: CollectionItem<Document>): number => {
    if (item.type === 'org') return -Infinity

    const recency = recencyScore(item, todayMs, horizonDays)
    const typeScore = TYPE_SCORES[item.type]
    const depthPenalty = Math.min(item.depth, 3)

    return recency + typeScore - depthPenalty
  }
}
