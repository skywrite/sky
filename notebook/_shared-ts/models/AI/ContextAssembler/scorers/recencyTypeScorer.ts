import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { Scorer } from '../mod.ts'
import { recencyScore } from './recencyScore.ts'

const TYPE_SCORES: Record<CollectionEntityType, number> = {
  goal: 5,
  decision: 5,
  project: 4,
  person: 3,
  org: 3,
  journal: 3,
  day: 3,
  idea: 2,
  meeting: 2,
  message: 2,
  video: 2,
  place: 1,
  document: 0,
}

export interface RecencyTypeScorerOptions {
  /** Paths retrieved by ai:context:files — these are query-relevant and get a score boost. */
  priorityPaths?: ReadonlySet<string>
  /** Recency horizon in days. Default 540 (18 months). */
  horizonDays?: number
}

export function createRecencyTypeScorer(today: PlainDate, opts?: RecencyTypeScorerOptions): Scorer {
  const todayMs = today.toDate().getTime()
  const priorityPaths = opts?.priorityPaths ?? new Set()
  const horizonDays = opts?.horizonDays ?? 540

  return (item: CollectionItem<Document>): number => {
    // Orgs at depth 2+ are transitive (e.g. meeting → person → org) — always prune
    if (item.type === 'org' && item.depth >= 2) return -Infinity

    const recency = recencyScore(item, todayMs, horizonDays)

    // Type (0-5)
    const typeScore = TYPE_SCORES[item.type]

    // Depth penalty (0-3)
    const depthPenalty = Math.min(item.depth, 3)

    // Priority boost: files retrieved by ai:context:files are query-relevant
    const priorityBoost = priorityPaths.has(item.path) ? 10 : 0

    return recency + typeScore - depthPenalty + priorityBoost
  }
}
