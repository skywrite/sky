import { REGEX_YMD_EXACT } from './regex/mod.ts'

/** A time the user typed literally in a freeform correction. */
export interface TypedTime {
  /** `YYYY-MM-DD HH:MM` when a date was typed, otherwise `HH:MM`. */
  value: string
  /** Whether a date component was present. */
  hasDate: boolean
  /** The exact text matched, for reporting back to the user. */
  raw: string
}

/**
 * Lift an explicitly labelled time out of a freeform correction string.
 *
 * Corrections are prompted as `time: 2026-01-20 14:30` / `when: 14:30`, and an
 * explicit `HH:MM` needs a regex, not a language model. Reading it here keeps
 * the model out of time handling entirely: it cannot normalize an extended
 * hour, roll a date forward, or reject a value it thinks is out of range.
 *
 * Only the labelled form is matched. A bare time elsewhere in the sentence
 * ("summary: the 3:30 standup") is left alone — that ambiguity is what sank
 * the abandoned REGEX_HHMM25_SUBSTR — and unlabelled or relative phrasing
 * ("push it back an hour") returns null so the caller can fall back to the AI.
 *
 * Extended hours are preserved verbatim: notebook time files late-night work
 * under the day it started, so `25:30` means 01:30 the next morning and is a
 * deliberate value (see docs/nbfs.md § "Extended and negative hours").
 */
export function extractTypedTime(correction: string): TypedTime | null {
  const labelled = correction.match(/(?:^|[,;\n])\s*(?:time|when)\s*:\s*([^,;\n]+)/i)
  if (!labelled) return null

  const raw = labelled[1].trim()
  const parts = raw.match(/^(?:(\S+)\s+)?(-?)(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!parts) return null

  const [, datePart, sign, hourText, minuteText, meridiem] = parts

  if (datePart !== undefined && !REGEX_YMD_EXACT.test(datePart)) return null
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
    value: datePart ? `${datePart} ${time}` : time,
    hasDate: datePart !== undefined,
    raw,
  }
}
