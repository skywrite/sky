import { Instant, type PlainDate } from '#universal/dates/nbdt/mod.ts'
import { wallClockParts } from './clock.ts'

// A silence this long in the activity stream, resuming the next calendar
// morning, is read as sleep — the notebook day's real boundary. day:start is
// the ceremony; waking up is the fact.
const WAKE_GAP_HOURS = 3

// Resumptions in this local-hour band read as "woke up and started working";
// earlier ones (00:30 after a long evening break) are still the same day's
// late-night extension, later ones can't follow a post-midnight gap.
const MORNING_FROM_HOUR = 3
const MORNING_TO_HOUR = 12

const isMorning = (hour: number) => hour >= MORNING_FROM_HOUR && hour < MORNING_TO_HOUR

/**
 * Find where a day's activity ends at a wake gap, or null when it doesn't.
 *
 * Scans sorted instants for the first silence of WAKE_GAP_HOURS or more whose
 * resumption lands on a later calendar day between 03:00 and 12:00 local —
 * i.e. the user slept and woke, even if the next day:start hasn't run yet.
 * Returns the last instant before that gap; everything after belongs to the
 * next day.
 *
 * `from` is the day's start. Given, it stands in for the signal before the
 * first instant, so a quiet day whose only signals are the next morning's
 * ends where it began instead of claiming them.
 *
 * The instants should be presence signals (typed prompts, authored commits),
 * not machine activity — an autonomous run churning overnight is not the
 * user's day continuing.
 */
export default function findWakeCutoff(
  instants: Instant[],
  day: PlainDate,
  timezone: string,
  from?: Instant,
): Instant | null {
  const gapMs = WAKE_GAP_HOURS * 3_600_000

  for (let i = 0; i < instants.length; i++) {
    const before = i > 0 ? instants[i - 1] : from
    if (!before) continue
    const after = instants[i]
    if (after.epochMilliseconds - before.epochMilliseconds < gapMs) continue

    const wall = wallClockParts(after, timezone)
    if (wall.ymd <= day.ymd) continue
    if (isMorning(wall.hour)) return before
  }

  return null
}

/**
 * The mirror of findWakeCutoff: where this day's activity BEGINS when work
 * started before the day:start ceremony. Scanning instants from a lookback
 * before the ceremony, the LAST wake gap resuming on this day's own morning
 * marks the true start — everything before the gap was the previous day's
 * late night. Null when the ceremony start stands (no qualifying gap).
 *
 * The scan's first instant follows at least the caller's lookback of silence,
 * so it is a resumption too: a lone early-morning signal before the ceremony
 * still opens the day.
 */
export function findWakeStart(
  instants: Instant[],
  day: PlainDate,
  timezone: string,
  ceremonyStart: Instant,
): Instant | null {
  const gapMs = WAKE_GAP_HOURS * 3_600_000
  let resumption: Instant | null = null

  for (let i = 0; i < instants.length; i++) {
    const after = instants[i]
    if (i > 0 && after.epochMilliseconds - instants[i - 1].epochMilliseconds < gapMs) continue
    if (Instant.compare(after, ceremonyStart) >= 0) break

    const wall = wallClockParts(after, timezone)
    if (wall.ymd !== day.ymd) continue
    if (isMorning(wall.hour)) resumption = after
  }

  return resumption
}
