import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { REGEX_HHMM25_EXACT } from '#universal/dates/regex/mod.ts'

/**
 * Where an accepted item lands, in a person's words.
 *
 * An action item is placed on a day, with a clock time when it is a
 * commitment, or on no day at all — the Next list. Both the terminal and
 * the page describe that placement, so the words live here, where either
 * can reach them: "Today", "Tomorrow", "Fri 13 Mar · 09:30", "Next".
 */

export interface PlaceWhen {
  /** The day, YYYY-MM-DD; null means the Next list */
  date: string | null
  /** The clock time, HH:MM, when the item is a commitment on that day */
  time: string | null
}

const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 13 Mar" */
export function shortDate(ymd: string): string {
  const day = new PlainDate(ymd)
  return `${WEEKDAY[day.dayOfWeek - 1].slice(0, 3)} ${day.day} ${MONTH[day.month - 1]}`
}

/** "Friday" */
export function weekdayName(ymd: string): string {
  return WEEKDAY[new PlainDate(ymd).dayOfWeek - 1]
}

/** "Today", "Tomorrow", else the short date */
export function dayLabel(ymd: string, today: string): string {
  const now = new PlainDate(today)
  if (ymd === now.ymd) return 'Today'
  if (ymd === now.addDays(1).ymd) return 'Tomorrow'
  return shortDate(ymd)
}

/** The days after tomorrow through the Sunday of today's week, as YYYY-MM-DD. */
export function restOfWeek(today: string): string[] {
  const now = new PlainDate(today)
  const days: string[] = []
  for (let offset = 2; now.dayOfWeek + offset <= 7; offset++) days.push(now.addDays(offset).ymd)
  return days
}

/** "Tomorrow", "Fri 13 Mar · 09:30", "Next" */
export function placeLabel(when: PlaceWhen, today: string): string {
  if (when.date === null) return 'Next'
  const day = dayLabel(when.date, today)
  return when.time ? `${day} · ${when.time}` : day
}

export type PlaceWhere = 'Todos' | 'Commitments' | 'schedule' | 'the list'

/**
 * Which list takes the item: a timed day is a Commitment, an untimed one a
 * Todo, a day past the last created day file waits in the schedule until
 * its week is made, and no day is the Next list.
 */
export function placeWhere(when: PlaceWhen, createdThrough: string | null): PlaceWhere {
  if (when.date === null) return 'the list'
  if (createdThrough === null || when.date > createdThrough) return 'schedule'
  return when.time ? 'Commitments' : 'Todos'
}

/** "Tomorrow · Todos", "Mon 16 Mar · schedule", "Next" */
export function placeDestination(when: PlaceWhen, today: string, createdThrough: string | null): string {
  if (when.date === null) return 'Next'
  return `${dayLabel(when.date, today)} · ${placeWhere(when, createdThrough)}`
}

/** "9:30" → "09:30"; extended hours stay ("25:30" is a real notebook time); anything else → null. */
export function normalizeClock(text: string): string | null {
  const match = text.trim().match(REGEX_HHMM25_EXACT)
  if (!match?.groups) return null
  return `${match.groups.hour.padStart(2, '0')}:${match.groups.minute.padStart(2, '0')}`
}
