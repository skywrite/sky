import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { keepAlways, type Scorer, scored } from '../mod.ts'

/**
 * Scorer tuned for summary:day context assembly.
 *
 * Two zones, split by path: documents inside the day directory are the
 * summary's subject; everything else is background that relationship
 * traversal pulled in. day.md and journals are pinned — a day summary
 * without the day's own record is meaningless. Among the day's actions,
 * meetings outrank messages, notes, then chats (a single chat can be most
 * of the budget). Background tiers: thread antecedents and referenced
 * decisions/goals above orgs/projects, people last — person files are the
 * bulk of the background on a busy day.
 *
 * No recency component and no floor: every document is either from the
 * target day or was pulled in deliberately, so the budget is purely an
 * outlier guard — on a normal day nothing is pruned.
 */

const IN_DAY_ACTION_SCORES: Partial<Record<CollectionEntityType, number>> = {
  meeting: 8,
  message: 7,
  video: 6,
  document: 6,
  chat: 5,
}

/** Unclassified in-day action files (notes, docs, events) score like notes. */
const IN_DAY_FALLBACK = 6

const BACKGROUND_SCORES: Partial<Record<CollectionEntityType, number>> = {
  message: 3, // previous-chain antecedents — what makes today's replies readable
  meeting: 3,
  chat: 3,
  decision: 3,
  goal: 3,
  project: 2,
  org: 2,
}

/** Remaining background (people, places, ideas, streaks) is pruned first. */
const BACKGROUND_FALLBACK = 1

export function createSummaryScorer(dayDirPath: string): Scorer {
  const dayPrefix = dayDirPath.endsWith('/') ? dayDirPath : `${dayDirPath}/`

  return (item: CollectionItem<Document>) => {
    if (item.path.startsWith(dayPrefix)) {
      if (item.type === 'day' || item.type === 'journal') return keepAlways("the day's own record")
      return scored(IN_DAY_ACTION_SCORES[item.type] ?? IN_DAY_FALLBACK)
    }
    return scored(BACKGROUND_SCORES[item.type] ?? BACKGROUND_FALLBACK)
  }
}
