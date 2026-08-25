import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { keepNever, type Scorer, scored } from '../mod.ts'
import { recencyScore } from './recencyScore.ts'

const TYPE_SCORES: Record<CollectionEntityType, number> = {
  goal: 5,
  decision: 5,
  memory: 4, // AI cross-session memory: present when on-topic (lexical lifts it), sheds under floor pressure otherwise
  streak: 4,
  tracking: 4,
  project: 4,
  person: 3,
  org: 3,
  journal: 3,
  day: 3,
  idea: 2,
  meeting: 2,
  message: 2,
  video: 2,
  chat: 2,
  place: 1,
  recap: 1, // regenerable digests; the day's summary already folds their content in
  document: 0,
}

// Project material fades by status when the token budget forces cuts:
// open > completed > whiteboard > canceled > hold. Completed projects are
// real accomplished work; hold is indefinite limbo. Penalties, not
// exclusions — ai:chat's retrieval-evidence boost (Chat/ChatContext/score.ts)
// still lifts a directly-asked-about archived project.
const PROJECT_STATUS_PENALTIES: ReadonlyArray<[string, number]> = [
  ['/projects/completed/', 1],
  ['/projects/whiteboard/', 1.5],
  ['/projects/canceled/', 2],
  ['/projects/hold/', 3],
]

function projectStatusPenalty(path: string): number {
  for (const [segment, penalty] of PROJECT_STATUS_PENALTIES) {
    if (path.includes(segment)) return penalty
  }
  return 0
}

export interface RecencyTypeScorerOptions {
  /** Recency horizon in days. Default 540 (18 months). */
  horizonDays?: number
}

export function createRecencyTypeScorer(today: PlainDate, opts?: RecencyTypeScorerOptions): Scorer {
  const todayMs = today.toDate().getTime()
  const horizonDays = opts?.horizonDays ?? 540

  return (item: CollectionItem<Document>) => {
    // Orgs at depth 2+ are transitive (e.g. meeting → person → org)
    if (item.type === 'org' && item.depth >= 2) return keepNever('transitive org (depth >= 2)')

    const recency = recencyScore(item, todayMs, horizonDays)

    // Type (0-5)
    const typeScore = TYPE_SCORES[item.type]

    // Depth penalty (0-3)
    const depthPenalty = Math.min(item.depth, 3)

    return scored(recency + typeScore - depthPenalty - projectStatusPenalty(item.path))
  }
}
