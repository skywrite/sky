import type DayDocument from '#shared/models/Day/document/mod.ts'
import durationStringToHours from '#universal/dates/durationStringToHours.ts'

/** Minutes after the day's midnight for `HH:MM`, hours past 23 kept; null when it isn't a time. */
export function clockMinutes(time: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(time.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Minutes back to `HH:MM`, hours past 23 kept: 1540 → `25:40`. */
function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * A day's own clock reaches into the next morning — a night that ran late is
 * still that day's. An end stamped past this point was a later sitting, not
 * the day's own end, and reads as the date it happened.
 */
const NEXT_NOON = 36 * 60

export interface DayBounds {
  /** `HH:MM` the day started; null for a day that never did */
  started: string | null
  ended: boolean
  /** The recorded end as a date and time, e.g. `2026-01-28 01:00` */
  endedAt: string | null
  /** The end as a person reads it: `22:41`, `25:40` past midnight, or `Jan 29, 21:30` once it fell past the next noon */
  endedClock: string | null
  /** The day was ended with every planned item done */
  perfect: boolean
}

export function dayEnd(document: DayDocument): DayBounds {
  const marker = document.yaml['ended']
  const ended = typeof marker === 'string' ? marker.trim() !== '' : Boolean(marker)
  const startedMarker = document.yaml['started']
  const started = typeof startedMarker === 'string' && clockMinutes(startedMarker) !== null ? startedMarker : null
  let endedAt: string | null = null
  let endedClock: string | null = null
  if (ended) {
    try {
      const end = document.ended
      endedAt = end?.plainDateTime.toString() ?? null
      const start = started === null ? null : clockMinutes(started)
      if (end && start !== null && typeof marker === 'string') {
        const minutes = start + Math.round(durationStringToHours(marker) * 60)
        endedClock = !Number.isFinite(minutes)
          ? null
          : minutes < NEXT_NOON
            ? clockOf(minutes)
            : `${end.plainDateTime.plainDate.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${end.plainDateTime.time}`
      }
    } catch {
      // An unreadable end time must not reopen the day or hide its lists.
    }
  }
  return { started, ended, endedAt, endedClock, perfect: ended && document.yaml['perfect'] === true }
}
