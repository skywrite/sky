import * as path from 'node:path'
import { DIR_STREAKS } from '#config'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import type DayDocument from '#shared/models/Day/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import StreakDocument, {
  computeStreakStats,
  STREAKS_LIST_TITLE,
  streaksItemsFromDay,
  type StreakDayEntry,
} from '#shared/models/Streak/mod.ts'
import { readDay } from '#shared/nbfs/mod.ts'
import * as dateFns from '#universal/dates/dateFns/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

const { addDays } = dateFns

/** Status is path-derived: streaks/active/ vs streaks/archived/. */
export type StreakStatus = 'active' | 'archived'

export interface LoadedStreak {
  streak: StreakDocument
  path: string
  status: StreakStatus
}

/** Load all streak rule docs of one status, sorted by name for stable stamping order. */
export async function loadStreaks(status: StreakStatus = 'active'): Promise<LoadedStreak[]> {
  const dir = path.join(DIR_STREAKS, status)
  if (!(await exists(dir))) return []

  const loaded: LoadedStreak[] = []
  for await (const entry of walk(dir, { exts: ['.md'], includeDirs: false })) {
    try {
      const streak = StreakDocument.fromMarkdown(await readTextFile(entry.path))
      if (streak.name) loaded.push({ streak, path: entry.path, status })
    } catch {
      // Skip unparseable files
    }
  }

  loaded.sort((a, b) => a.streak.name.localeCompare(b.streak.name))
  return loaded
}

export async function loadAllStreaks(): Promise<LoadedStreak[]> {
  return [...(await loadStreaks('active')), ...(await loadStreaks('archived'))]
}

/**
 * Ensure a day document carries the ## Streaks list with one item per streak
 * tracked on `date`.
 *
 * - Adds missing items (bare title, or decorated when `counts` has an entry).
 * - Refreshes the decoration on UNSTRUCK items only — struck items are
 *   completion records and are never touched.
 * - Unrecognized items (hand-added) are preserved.
 * - Never removes items.
 *
 * Returns the same instance when nothing needs to change.
 */
export function stampStreaksList(
  day: DayDocument,
  streaks: StreakDocument[],
  date: PlainDate,
  counts?: Map<string, number>,
): DayDocument {
  const tracked = streaks.filter((s) => s.isTrackedOn(date))
  if (tracked.length === 0) return day

  const existing = day.lists.find((list) => list.title === STREAKS_LIST_TITLE)
  const items = existing ? [...existing.items] : []
  let changed = false

  for (const streak of tracked) {
    const index = items.findIndex((item) => streak.matchesDayItem(item))
    const count = counts?.get(streak.name)

    if (index === -1) {
      items.push(StreakDocument.formatDayItem(streak.title, count))
      changed = true
      continue
    }

    // Only a fresh count may rewrite an existing item — stamping without
    // counts must never strip a decoration someone else put there.
    if (count === undefined) continue

    const current = items[index]
    const desired = StreakDocument.formatDayItem(streak.title, count)
    const isStruck = /^~~.*~~$/.test(current.trim())
    if (!isStruck && current !== desired) {
      items[index] = desired
      changed = true
    }
  }

  if (!changed && existing) return day

  const newList = new ItemList({ title: STREAKS_LIST_TITLE, items })
  if (existing) return day.replaceList(STREAKS_LIST_TITLE, newList)

  // New list goes between Reminders and the Complete sections; append when no
  // Complete section exists (non-standard day files).
  const completeIndex = day.findListIndex((list) => list.title.endsWith('Complete'))
  if (completeIndex === -1) return day.addList(newList)
  return day.insertList(completeIndex, newList)
}

export type StrikeResult =
  | { kind: 'struck'; day: DayDocument; item: string }
  | { kind: 'already'; item: string }
  | { kind: 'not-tracked' }

/**
 * Strike a streak's item in a day document — the CLI twin of the editor's
 * checkbox toggle. Stamps the item first if the list doesn't carry it yet.
 * Returns the updated day only when a strike actually happened.
 */
export function strikeStreakItem(day: DayDocument, streak: StreakDocument, date: PlainDate): StrikeResult {
  if (!streak.isTrackedOn(date)) return { kind: 'not-tracked' }

  const working = stampStreaksList(day, [streak], date)
  const list = working.lists.find((l) => l.title === STREAKS_LIST_TITLE)
  const index = list ? list.items.findIndex((item) => streak.matchesDayItem(item)) : -1
  if (!list || index === -1) return { kind: 'not-tracked' }

  const current = list.items[index]
  if (/^~~.*~~$/.test(current.trim())) return { kind: 'already', item: current }

  const items = [...list.items]
  items[index] = `~~${current}~~`

  return {
    kind: 'struck',
    day: working.replaceList(STREAKS_LIST_TITLE, new ItemList({ title: STREAKS_LIST_TITLE, items })),
    item: items[index],
  }
}

/**
 * Read the Streaks-list items from every day file in an inclusive date range.
 * Days without a file are skipped — the stats walker treats the gap as a miss.
 */
export async function loadStreakEntries(from: PlainDate, to: PlainDate): Promise<StreakDayEntry[]> {
  const entries: StreakDayEntry[] = []

  let cursor = from
  while (PlainDate.compare(cursor, to) <= 0) {
    try {
      const day = await readDay(cursor)
      entries.push({ day: cursor, items: streaksItemsFromDay(day) })
    } catch {
      // No day file for this date
    }
    cursor = new PlainDate(addDays(cursor.toDate(), 1))
  }

  return entries
}

/** Current-run count per streak name, for decorating day items (`— 12d`). */
export async function computeStreakCounts(streaks: StreakDocument[], today: PlainDate): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  const starts = streaks.map((s) => s.start).filter((s): s is PlainDate => s !== undefined)
  if (starts.length === 0) return counts

  const earliest = starts.reduce((a, b) => (PlainDate.compare(a, b) <= 0 ? a : b))
  const entries = await loadStreakEntries(earliest, today)

  for (const streak of streaks) {
    counts.set(streak.name, computeStreakStats(streak, entries, today).current)
  }

  return counts
}
