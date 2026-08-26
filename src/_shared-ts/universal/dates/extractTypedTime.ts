import isLeapYear from './isLeapYear.ts'
import { REGEX_YMD_EXACT } from './regex/mod.ts'

/** A time the user typed literally in a freeform correction. */
export interface TypedTime {
  /** `YYYY-MM-DD HH:MM` when a date was typed, otherwise `HH:MM`. */
  value: string
  /** Whether a date component was present. */
  hasDate: boolean
  /** Whether the year came from the reference date rather than the user. */
  yearInferred: boolean
  /** The exact text matched, for reporting back to the user. */
  raw: string
}

const LABELLED_TIME = /(?:^|[,;\n])\s*(?:time|when)\s*:\s*([^,;\n]+)/i
const PARTIAL_MD = /^(\d{1,2})-(\d{1,2})$/

/**
 * The raw text of a labelled `time:`/`when:` value, whether or not it parses.
 *
 * When extractTypedTime declines, callers show this so the user knows their
 * typed time is being handed to the AI instead of read literally — a silent
 * fallthrough once shipped a typed partial date under a hallucinated year.
 */
export function labelledTimeRaw(correction: string): string | null {
  return correction.match(LABELLED_TIME)?.[1].trim() ?? null
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/**
 * Resolve `MM-DD` to its most recent occurrence on or before the reference
 * date. Corrections describe things that already happened, so "09-15" typed in
 * August means last September, not next month. Walking years back handles
 * Feb 29, whose latest occurrence can lie several years behind the reference.
 */
function resolvePartialDate(monthText: string, dayText: string, referenceDate: string): string | null {
  const ref = referenceDate.match(REGEX_YMD_EXACT)?.groups
  if (!ref) return null
  const month = Number(monthText)
  const day = Number(dayText)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const startYear = Number(ref.year) - (monthDay <= `${ref.month}-${ref.day}` ? 0 : 1)
  for (let year = startYear; year >= startYear - 8; year--) {
    if (day <= daysInMonth(year, month)) return `${year}-${monthDay}`
  }
  return null // a day no month has, like 06-31
}

/**
 * Lift an explicitly labelled time out of a freeform correction string.
 *
 * Corrections are prompted as `time: 2026-01-20 14:30` / `when: 14:30`, and an
 * explicit `HH:MM` needs a regex, not a language model. Reading it here keeps
 * the model out of time handling entirely: it cannot normalize an extended
 * hour, roll a date forward, or reject a value it thinks is out of range.
 *
 * A partial `MM-DD HH:MM` resolves against `referenceDate` (the notebook's
 * current date, passed in — this module stays clock-free) to its most recent
 * occurrence on or before that date, and the result carries `yearInferred` so
 * callers can echo the year they chose. Without a referenceDate, a partial
 * date returns null like any other unreadable value.
 *
 * Only the labelled form is matched. A bare time elsewhere in the sentence
 * ("summary: the 3:30 standup") is left alone — that ambiguity is what sank
 * the abandoned REGEX_HHMM25_SUBSTR — and unlabelled or relative phrasing
 * ("push it back an hour") returns null so the caller can fall back to the AI.
 * Callers should surface that fallthrough via labelledTimeRaw, so a typed time
 * never silently becomes a model guess.
 *
 * Extended hours are preserved verbatim: notebook time files late-night work
 * under the day it started, so `25:30` means 01:30 the next morning and is a
 * deliberate value (see docs/nbfs.md § "Extended and negative hours").
 */
export function extractTypedTime(correction: string, referenceDate?: string): TypedTime | null {
  const labelled = correction.match(LABELLED_TIME)
  if (!labelled) return null

  const raw = labelled[1].trim()
  const parts = raw.match(/^(?:(\S+)\s+)?(-?)(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!parts) return null

  const [, datePart, sign, hourText, minuteText, meridiem] = parts

  let dateOut = datePart
  let yearInferred = false
  if (datePart !== undefined && !REGEX_YMD_EXACT.test(datePart)) {
    if (referenceDate === undefined) return null
    const partial = datePart.match(PARTIAL_MD)
    if (!partial) return null
    const resolved = resolvePartialDate(partial[1], partial[2], referenceDate)
    if (resolved === null) return null
    dateOut = resolved
    yearInferred = true
  }
  if (Number(minuteText) > 59) return null

  const hour = Number(hourText)
  let hourOut: string

  if (meridiem) {
    // A meridiem only makes sense on a clock hour, and never with a sign.
    if (sign || hour < 1 || hour > 12) return null
    const base = hour % 12
    hourOut = String(meridiem.toLowerCase() === 'pm' ? base + 12 : base).padStart(2, '0')
  } else {
    // Extended hours (25:30, 49:30) pass through; pad only an unsigned clock
    // hour, so a typed 8:44 becomes 08:44 and -7:56 keeps its documented form.
    hourOut = !sign && hour < 10 ? `0${hour}` : `${sign}${hour}`
  }

  const time = `${hourOut}:${minuteText}`
  return {
    value: dateOut ? `${dateOut} ${time}` : time,
    hasDate: dateOut !== undefined,
    yearInferred,
    raw,
  }
}
