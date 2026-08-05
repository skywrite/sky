import DayDocument from '#shared/models/Day/mod.ts'
import * as dateFns from '#universal/dates/dateFns/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import StreakDocument, { STREAKS_LIST_TITLE } from '../document/mod.ts'

const { addDays } = dateFns

/** One day's Streaks-list items, extracted from a day file. */
export interface StreakDayEntry {
  day: PlainDate
  items: string[]
}

export interface StreakStats {
  name: string
  title: string
  /** Length of the run ending now — consecutive completed tracked days. */
  current: number
  /** Longest run ever. */
  best: number
  /** Whether today's file should carry this streak's item. */
  trackedToday: boolean
  /** Whether today's item is struck. */
  completedToday: boolean
  /** Done count for today's month, up through yesterday (plus today once done). */
  monthDone: number
  /** Tracked-day count for the same window — the consistency denominator. */
  monthTracked: number
  /** Most recent completed day. */
  lastDone?: PlainDate
}

/** Pull the Streaks-list items out of a parsed day file. */
export function streaksItemsFromDay(day: DayDocument): string[] {
  return day.lists.find((list) => list.title === STREAKS_LIST_TITLE)?.items ?? []
}

/**
 * Compute run statistics for one streak by walking every day from its start
 * through `today`, judging each tracked day against the day files' Streaks
 * lists (via the same strikethrough test the editor uses).
 *
 * Semantics:
 * - Untracked days (pre-start, past-end, off-schedule) are transparent —
 *   they neither extend nor break runs.
 * - A tracked day with no struck item (or no day file at all) is a miss,
 *   and a miss resets the run.
 * - Today is pending until struck: it can extend the run, but an unstruck
 *   today never counts as a miss — the day isn't over.
 */
export function computeStreakStats(
  streak: StreakDocument,
  entries: StreakDayEntry[],
  today: PlainDate = PlainDate.today(),
): StreakStats {
  const stats: StreakStats = {
    name: streak.name,
    title: streak.title,
    current: 0,
    best: 0,
    trackedToday: streak.isTrackedOn(today),
    completedToday: false,
    monthDone: 0,
    monthTracked: 0,
  }

  const start = streak.start
  if (!start || PlainDate.compare(start, today) > 0) return stats

  const itemsByDay = new Map<string, string[]>()
  for (const entry of entries) {
    itemsByDay.set(entry.day.ymd, entry.items)
  }

  let run = 0
  let best = 0

  let cursor = start
  while (PlainDate.compare(cursor, today) <= 0) {
    if (!streak.isTrackedOn(cursor)) {
      cursor = nextDay(cursor)
      continue
    }

    const items = itemsByDay.get(cursor.ymd) ?? []
    const item = items.find((i) => streak.matchesDayItem(i))
    const done = item !== undefined && DayDocument.isItemDone(item)
    const isToday = cursor.ymd === today.ymd

    if (done) {
      run++
      stats.lastDone = cursor
      if (run > best) best = run
    } else if (!isToday) {
      run = 0
    }

    const sameMonth = cursor.year === today.year && cursor.month === today.month
    if (sameMonth && (!isToday || done)) {
      stats.monthTracked++
      if (done) stats.monthDone++
    }

    if (isToday) stats.completedToday = done

    cursor = nextDay(cursor)
  }

  stats.current = run
  stats.best = best
  return stats
}

function nextDay(day: PlainDate): PlainDate {
  return new PlainDate(addDays(day.toDate(), 1))
}
