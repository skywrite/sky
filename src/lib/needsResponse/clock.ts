import { Instant, PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { QUIET_HOURS, RESPONSE_MARK_HOURS, RESPONSE_POINTS } from './marks.ts'

const HOUR_MS = 3_600_000

/** The calendar date (`YYYY-MM-DD`) an instant falls on in a zone. */
export function localDateOf(epochMs: number, timezone: string): string {
  return Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timezone).toPlainDate().toString()
}

/** The waking stretch of one calendar date, as two instants. */
function wakingWindow(date: string, timezone: string): [number, number] {
  return [
    new ZonedDateTime({ date, time: QUIET_HOURS.until, timezone }).epochMilliseconds,
    new ZonedDateTime({ date, time: QUIET_HOURS.from, timezone }).epochMilliseconds,
  ]
}

function nextDate(date: string): string {
  return new PlainDate(date).addDays(1).ymd
}

/** Milliseconds between two instants that fall outside the quiet hours. */
export function countedMs(startMs: number, endMs: number, timezone: string): number {
  if (endMs <= startMs) return 0
  const lastDate = localDateOf(endMs, timezone)
  let total = 0
  for (let date = localDateOf(startMs, timezone); date <= lastDate; date = nextDate(date)) {
    const [from, until] = wakingWindow(date, timezone)
    total += Math.max(0, Math.min(endMs, until) - Math.max(startMs, from))
  }
  return total
}

/** The instant at which `hours` outside the quiet hours have passed since `startMs`. */
export function countedDeadline(startMs: number, hours: number, timezone: string): number {
  let remaining = hours * HOUR_MS
  let date = localDateOf(startMs, timezone)
  // A mark of at most 12 counted hours is always reached within two calendar days.
  for (let day = 0; day < 8; day++) {
    const [from, until] = wakingWindow(date, timezone)
    const begin = Math.max(startMs, from)
    if (until > begin) {
      if (until - begin >= remaining) return begin + remaining
      remaining -= until - begin
    }
    date = nextDate(date)
  }
  return startMs + hours * HOUR_MS
}

/** The first mark that follows the calendar. The marks before it leave the night out. */
const FIRST_DAY_MARK = RESPONSE_MARK_HOURS.findIndex((hours) => hours >= 24)

/** How many marks a message waiting since `sinceMs` has passed by `atMs`: 0 is inside the first mark. */
export function marksPassed(sinceMs: number, atMs: number, timezone: string): number {
  const wall = atMs - sinceMs
  for (let mark = RESPONSE_MARK_HOURS.length - 1; mark >= FIRST_DAY_MARK; mark--) {
    if (wall > RESPONSE_MARK_HOURS[mark] * HOUR_MS) return mark + 1
  }
  // Inside the first day the night is left out, so an evening message is not late by morning.
  const counted = countedMs(sinceMs, atMs, timezone)
  for (let mark = FIRST_DAY_MARK - 1; mark >= 0; mark--) {
    if (counted > RESPONSE_MARK_HOURS[mark] * HOUR_MS) return mark + 1
  }
  return 0
}

/** What a reply sent at `atMs` earns for a message waiting since `sinceMs`. */
export function pointsAt(sinceMs: number, atMs: number, timezone: string): number {
  return RESPONSE_POINTS[marksPassed(sinceMs, atMs, timezone)]
}

/** The instant a waiting message next loses points, or null once it is worth nothing. */
export function nextDropAt(sinceMs: number, atMs: number, timezone: string): number | null {
  const marks = marksPassed(sinceMs, atMs, timezone)
  if (marks >= RESPONSE_MARK_HOURS.length) return null
  if (marks >= FIRST_DAY_MARK) return sinceMs + RESPONSE_MARK_HOURS[marks] * HOUR_MS
  const dayMark = sinceMs + RESPONSE_MARK_HOURS[FIRST_DAY_MARK] * HOUR_MS
  return Math.min(countedDeadline(sinceMs, RESPONSE_MARK_HOURS[marks], timezone), dayMark)
}
