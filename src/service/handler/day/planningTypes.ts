import { entryLengthMinutes } from '#universal/dates/entryLength.ts'
import type { DayView } from './mod.ts'

export { entryLengthMinutes, normalizeEntryLength } from '#universal/dates/entryLength.ts'

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

const TIMED = /^(?<time>\d{1,2}:\d{2})\s*>?\s*(?<text>.*)$/
const TIMED_LENGTH = /^(?<time>\d{1,2}:\d{2})(?<length>\s*\([^()>]*\)|\s+[^\s>][^>]*?)\s*>\s*(?<text>.*)$/
const COMPLETE_LIST = /(?<!in)complete$/i

/**
 * A bullet's clock and words: `09:30 > Call Jane`. A Complete entry may also say how long it
 * took, attached to the time — `08:30(4h) > …`. Older `08:30 4h > …` entries remain readable.
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
