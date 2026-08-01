import type { Document } from '#shared/models/Markdown/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import StreakDocument, {
  computeStreakStats,
  streaksItemsFromDay,
  type StreakDayEntry,
} from '#shared/models/Streak/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import type DomainCollection from '../../mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import { type EntitySpec, type TagFilter, type TextFilter, matchesTagFilter, matchesTextFilter } from './shared.ts'

export interface StreakFilter extends TagFilter, TextFilter {
  name?: string
  nameContains?: string
  titleContains?: string
  status?: string
  schedule?: string
}

/** Status is path-derived for streaks, like ideas. */
export function streakStatusFromPath(path: string): string {
  return path.includes('/archived/') ? 'archived' : 'active'
}

/**
 * Constructed rather than cast, like videos: outside fromStore (mock stores,
 * fromDocuments-built collections) a path-detected streak is a plain Document,
 * and the stats walk needs real StreakDocument behavior.
 */
export function toStreakDocument(doc: Document): StreakDocument {
  return doc instanceof StreakDocument ? doc : new StreakDocument(doc.yaml, doc.markdown, doc.yamlError)
}

export function matchesStreakFilter(doc: Document, filter: StreakFilter, path: string): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.titleContains && !matchesContains(doc, 'title', filter.titleContains)) return false
  if (filter.status && streakStatusFromPath(path) !== filter.status) return false
  if (filter.schedule && !matchesExact(doc, 'schedule', filter.schedule)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  return true
}

/**
 * Walk the day history for streak completions. Days without a Streaks section
 * are skipped by a string check before the full re-parse into a DayDocument —
 * the scanner stores plain Documents, which have no lists.
 */
export function collectStreakDays(domain: DomainCollection): StreakDayEntry[] {
  const entries: StreakDayEntry[] = []
  for (const { doc, path } of domain.entriesByType('day')) {
    if (!doc.markdown.includes('## Streaks')) continue
    let day: PlainDate
    try {
      day = parseDateFromDayPath(path)
    } catch {
      continue
    }
    const items = streaksItemsFromDay(DayDocument.fromMarkdown(doc.toMarkdown()))
    if (items.length > 0) entries.push({ day, items })
  }
  return entries
}

export function docToStreak(streak: StreakDocument, path: string, stats: ReturnType<typeof computeStreakStats>) {
  return {
    name: streak.name,
    title: streak.title,
    status: streakStatusFromPath(path),
    schedule: streak.schedule,
    start: streak.start?.ymd ?? null,
    end: streak.end?.ymd ?? null,
    current: stats.current,
    best: stats.best,
    trackedToday: stats.trackedToday,
    completedToday: stats.completedToday,
    monthDone: stats.monthDone,
    monthTracked: stats.monthTracked,
    lastDone: stats.lastDone?.ymd ?? null,
    tags: Array.from(streak.tags),
    rel: Array.from(streak.rel),
    markdown: streak.markdown,
    path,
  }
}

export default {
  type: 'streak',
  matches: (doc, filter, path) => matchesStreakFilter(doc, filter, path),
  mapper: (ctx) => {
    // The day walk is lazy: only a streak query pays for it, and only once per
    // resolver set (= this store version). `today` is read per query instead,
    // so a long-lived resolver set does not freeze the streak's "current".
    let dayEntries: StreakDayEntry[] | null = null
    return (entries) => {
      const days = (dayEntries ??= collectStreakDays(ctx.domain))
      const today = PlainDate.today()
      return entries.map(({ doc, path }) => {
        const streak = toStreakDocument(doc)
        return docToStreak(streak, path, computeStreakStats(streak, days, today))
      })
    }
  },
} satisfies EntitySpec<StreakFilter, ReturnType<typeof docToStreak>>
