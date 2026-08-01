import type { Document } from '#shared/models/Markdown/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import type StreakDocument from '#shared/models/Streak/mod.ts'
import { streaksItemsFromDay } from '#shared/models/Streak/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { matchesExact } from '../filters/mod.ts'
import {
  type DatedFilter,
  type EntitySpec,
  type TagFilter,
  getDateForDocument,
  getOptionalStringField,
  matchesDatedFilter,
  matchesTagFilter,
} from './shared.ts'
import { toStreakDocument } from './streak.ts'

export interface DayFilter extends DatedFilter, TagFilter {
  year?: number
  month?: number
}

export function matchesDayFilter(doc: Document, filter: DayFilter, path?: string): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.year !== undefined && !matchesExact(doc, 'year', filter.year)) return false
  if (filter.month !== undefined && !matchesExact(doc, 'month', filter.month)) return false
  if (!matchesTagFilter(doc, filter)) return false
  return true
}

export function docToDay(doc: Document, path: string) {
  // Get date from YAML or extract from path
  const dateStr = getDateForDocument(doc, path) ?? ''
  const [yearStr, monthStr] = dateStr.split('-')
  return {
    date: dateStr,
    year: parseInt(yearStr, 10) || 0,
    month: parseInt(monthStr, 10) || 0,
    started: getOptionalStringField(doc, 'started'),
    ended: getOptionalStringField(doc, 'ended'),
    location: getOptionalStringField(doc, 'location'),
    tz: getOptionalStringField(doc, 'tz'),
    tags: Array.from(doc.tags),
    markdown: doc.markdown,
    path,
  }
}

/** Per-day completion fields: which streaks were struck / left unstruck. */
export function streakDayFields(doc: Document, path: string, streaks: StreakDocument[]) {
  const empty = { streaksCompleted: [] as string[], streaksMissed: [] as string[] }
  if (streaks.length === 0) return empty

  let date: PlainDate
  try {
    date = parseDateFromDayPath(path)
  } catch {
    return empty
  }

  const items = doc.markdown.includes('## Streaks')
    ? streaksItemsFromDay(DayDocument.fromMarkdown(doc.toMarkdown()))
    : []

  const streaksCompleted: string[] = []
  const streaksMissed: string[] = []
  for (const streak of streaks) {
    if (!streak.isTrackedOn(date)) continue
    const item = items.find((i) => streak.matchesDayItem(i))
    if (item !== undefined && DayDocument.isItemDone(item)) streaksCompleted.push(streak.name)
    else streaksMissed.push(streak.name)
  }
  return { streaksCompleted, streaksMissed }
}

export default {
  type: 'day',
  sortByDate: true,
  matches: (doc, filter, path) => matchesDayFilter(doc, filter, path),
  // Read per query rather than per resolver set: the streak set is small, and a
  // day's completion fields have to reflect streaks as they stand right now.
  mapper: (ctx) => (entries) => {
    const streaks = ctx.domain.entriesByType('streak').map(({ doc }) => toStreakDocument(doc))
    return entries.map(({ doc, path }) => ({
      ...docToDay(doc, path),
      ...streakDayFields(doc, path, streaks),
    }))
  },
} satisfies EntitySpec<DayFilter, ReturnType<typeof docToDay> & ReturnType<typeof streakDayFields>>
