import type { DayView } from './mod.ts'

export type DayPlanKind = 'todos' | 'commitments' | 'reminders'
export type DayAddKind = DayPlanKind | 'complete'
export type NextDestination = Exclude<DayPlanKind, 'commitments'>
export type NextFile = 'next-professional.md' | 'next-personal.md'

export interface DayPlanInput {
  kind: DayAddKind
  text: string
  category: string
  time?: string
  /** How long a completed entry took, in the day file's spelling: `4h`, `90m` */
  length?: string
}

export interface NextDayItem {
  id: string
  file: NextFile
  path: string
  list: string
  category: 'Professional' | 'Personal'
  text: string
  already: boolean
  unavailable: string | null
}

export interface DayPlanResult {
  view: DayView
  undo: string
  message: string
}

/** Accept the notebook's extended hours as well as ordinary clock times. */
export function normalizeDayTime(value: string): string | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim())
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null
}

const LENGTH_PART = /^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?![a-z])/
const HOURS_THEN_MINUTES = /^(\d+)\s*(?:hours?|hrs?|h)\s*([0-5]?\d)$/

/** Whole minutes in a length as a person types it — `45m`, `2 hours`, `1h 30m`, `1h30`, `1.5h`, `1:30` — or null. */
export function entryLengthMinutes(value: string): number | null {
  let rest = value
    .trim()
    .toLowerCase()
    .replace(/^\((.*)\)$/, '$1')
    .trim()
  let minutes = 0
  const split = /^(\d+):([0-5]\d)$/.exec(rest) ?? HOURS_THEN_MINUTES.exec(rest)
  if (split) minutes = Number(split[1]) * 60 + Number(split[2])
  else {
    // A bare number could be minutes or hours, so it is not a length.
    if (!rest) return null
    while (rest) {
      const part = LENGTH_PART.exec(rest)
      if (!part) return null
      minutes += Number(part[1]) * (part[2].startsWith('h') ? 60 : 1)
      rest = rest.slice(part[0].length).trimStart()
    }
  }
  const whole = Math.round(minutes)
  return whole > 0 ? whole : null
}

/** A typed length in the day file's spelling: whole hours as `4h`, anything else in minutes, `90m`. */
export function normalizeEntryLength(value: string): string | null {
  const minutes = entryLengthMinutes(value)
  if (minutes === null) return null
  return minutes % 60 ? `${minutes}m` : `${minutes / 60}h`
}

const TIMED = /^(?<time>\d{1,2}:\d{2})\s*>?\s*(?<text>.*)$/
const TIMED_LENGTH = /^(?<time>\d{1,2}:\d{2})(?<length>\s*\([^()>]*\)|\s+[^\s>][^>]*?)\s*>\s*(?<text>.*)$/
const COMPLETE_LIST = /(?<!in)complete$/i

/**
 * A bullet's clock and words: `09:30 > Call Jane`. A Complete entry may also say how long it
 * took, between the time and the arrow — `08:30 4h > …`, or `08:30(4h) > …` as typed by hand.
 * A plan row keeps such words as written.
 */
export function splitItemTime(
  text: string,
  list: string,
): { time: string | null; minutes: number | null; text: string } {
  const long = COMPLETE_LIST.test(list) ? TIMED_LENGTH.exec(text) : null
  const minutes = long?.groups ? entryLengthMinutes(long.groups.length) : null
  const timed = minutes ? long : TIMED.exec(text)
  if (!timed?.groups) return { time: null, minutes: null, text }
  return { time: timed.groups.time, minutes, text: timed.groups.text }
}

export { comparePlanItems } from '#lib/nbfs/comparePlanItems.ts'
