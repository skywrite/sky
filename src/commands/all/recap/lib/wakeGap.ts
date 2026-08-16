import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
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

/**
 * Find where a day's activity ends at a wake gap, or null when it doesn't.
 *
 * Scans sorted instants for the first silence of WAKE_GAP_HOURS or more whose
 * resumption lands on a later calendar day between 03:00 and 12:00 local —
 * i.e. the user slept and woke, even if the next day:start hasn't run yet.
 * Returns the last instant before that gap; everything after belongs to the
 * next day.
 *
 * The instants should be presence signals (typed prompts, authored commits),
 * not machine activity — an autonomous run churning overnight is not the
 * user's day continuing.
 */
export default function findWakeCutoff(instants: Date[], day: PlainDate, timezone: string): Date | null {
  const gapMs = WAKE_GAP_HOURS * 3_600_000

  for (let i = 1; i < instants.length; i++) {
    const before = instants[i - 1]
    const after = instants[i]
    if (after.getTime() - before.getTime() < gapMs) continue

    const wall = wallClockParts(after, timezone)
    if (wall.ymd <= day.ymd) continue
    if (wall.hour >= MORNING_FROM_HOUR && wall.hour < MORNING_TO_HOUR) return before
  }

  return null
}

/**
 * The mirror of findWakeCutoff: where this day's activity BEGINS when work
 * started before the day:start ceremony. Scanning instants from a lookback
 * before the ceremony, the LAST wake gap resuming on this day's own morning
 * marks the true start — everything before the gap was the previous day's
 * late night. Null when the ceremony start stands (no qualifying gap).
 */
export function findWakeStart(instants: Date[], day: PlainDate, timezone: string, ceremonyStart: Date): Date | null {
  const gapMs = WAKE_GAP_HOURS * 3_600_000
  let resumption: Date | null = null

  for (let i = 1; i < instants.length; i++) {
    const before = instants[i - 1]
    const after = instants[i]
    if (after.getTime() - before.getTime() < gapMs) continue
    if (after >= ceremonyStart) break

    const wall = wallClockParts(after, timezone)
    if (wall.ymd !== day.ymd) continue
    if (wall.hour >= MORNING_FROM_HOUR && wall.hour < MORNING_TO_HOUR) resumption = after
  }

  return resumption
}
