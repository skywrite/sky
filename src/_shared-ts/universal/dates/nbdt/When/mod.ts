/**
 * The `when:` frontmatter value for day-partitioned documents.
 *
 *   when: 2026-08-05 07:13              # a moment
 *   when: 2026-08-05 10:15 70m          # a moment plus a length
 *   when: 2026-08-05 10:15 - 11:25      # a moment plus an end (dash may be unspaced)
 *
 * One line, greppable and sortable by its datetime prefix, and cheap in an LLM
 * context window — which is where most of these values are eventually read.
 *
 * Length is optional, and when present may be written either way. The two forms
 * are not redundant: a calendar entry knows its end time, an audio transcript
 * knows its length, a message knows neither. Whichever fact was actually known
 * is what gets stored; the other is derived. Hours may exceed 24 — a late night
 * files under the day it started, so 25:30 is a real time and a range crossing
 * midnight is written 23:30 - 24:30, never - 00:30.
 *
 * Reading is lenient about spacing and zero-padding so hand edits survive;
 * writing is always canonical, which is what keeps the format from drifting.
 */
import ms from 'ms'
import PlainDateTime from '../PlainDateTime/mod.ts'

const DATE = String.raw`\d{4}-\d{2}-\d{2}`
const TIME = String.raw`\d{1,2}:\d{2}`
const DURATION = String.raw`\d+(?:\.\d+)?\s*[a-zA-Z]+`
const WHEN_RE = new RegExp(String.raw`^(${DATE})\s+(${TIME})(?:\s*-\s*(${TIME})|\s+(${DURATION}))?$`)

/** How the length was written, so serialization can give it back unchanged. */
type Suffix = { kind: 'none' } | { kind: 'duration'; text: string } | { kind: 'end'; minutes: number }

export default class When {
  readonly datetime: PlainDateTime
  readonly #suffix: Suffix

  private constructor(datetime: PlainDateTime, suffix: Suffix) {
    this.datetime = datetime
    this.#suffix = suffix
  }

  /** Length as an ms-style string, derived when the value was written as a range. */
  get duration(): string | null {
    if (this.#suffix.kind === 'none') return null
    if (this.#suffix.kind === 'duration') return this.#suffix.text
    return `${this.#suffix.minutes - startMinutes(this.datetime)}m`
  }

  /** Whole minutes, rounded — `70m` is 70, `45s` is 1. */
  get durationMinutes(): number | null {
    if (this.#suffix.kind === 'none') return null
    if (this.#suffix.kind === 'end') return this.#suffix.minutes - startMinutes(this.datetime)
    return Math.round(durationToMs(this.#suffix.text) / 60_000)
  }

  /** End of the event, derived when the value was written as a length. */
  get end(): PlainDateTime | null {
    const minutes = this.durationMinutes
    if (minutes === null) return null
    return this.datetime.addHours(minutes / 60)
  }

  /** Parse the frontmatter string. Anything off-grammar throws. */
  static fromYaml(value: unknown): When {
    if (typeof value !== 'string') {
      throw new RangeError(`when: must be a "YYYY-MM-DD HH:MM [length]" string, got ${describe(value)}`)
    }
    const match = value.trim().match(WHEN_RE)
    if (!match) {
      throw new RangeError(`when: must be "YYYY-MM-DD HH:MM", "… 70m", or "… - HH:MM", got ${describe(value)}`)
    }

    const [, date, time, endText, durationText] = match
    const datetime = PlainDateTime.fromString(`${date} ${padTime(time)}`)

    if (endText !== undefined) {
      const endMins = toMinutes(endText)
      const startMins = startMinutes(datetime)
      if (endMins <= startMins) {
        throw new RangeError(
          `when: the end must be after the start — for a range crossing midnight use extended hours ` +
            `(e.g. "${padTime(time)} - ${formatMinutes(endMins + 24 * 60)}"), got ${describe(value)}`,
        )
      }
      return new When(datetime, { kind: 'end', minutes: endMins })
    }

    if (durationText !== undefined) {
      const text = durationText.replace(/\s+/g, '')
      durationToMs(text) // validates, throws on garbage or non-positive
      return new When(datetime, { kind: 'duration', text })
    }

    return new When(datetime, { kind: 'none' })
  }

  /**
   * Normalize the shapes a caller might hold into a When. Undefined means now.
   * A PlainDateTime may carry a length alongside it.
   */
  static from(input?: When | PlainDateTime | string | null, duration?: string | null): When {
    if (input instanceof When) return input
    if (input === undefined || input === null) return When.from(new PlainDateTime(), duration)
    if (input instanceof PlainDateTime) {
      const suffix = duration ? ` ${duration}` : ''
      return When.fromYaml(`${input.date} ${padTime(input.time)}${suffix}`)
    }
    return When.fromYaml(input)
  }

  /** Canonical one-line form — this is what gets written to frontmatter. */
  toYaml(): string {
    return this.toString()
  }

  toJSON(): string {
    return this.toString()
  }

  toString(): string {
    const base = `${this.datetime.date} ${padTime(this.datetime.time)}`
    if (this.#suffix.kind === 'none') return base
    if (this.#suffix.kind === 'duration') return `${base} ${this.#suffix.text}`
    return `${base} - ${formatMinutes(this.#suffix.minutes)}`
  }
}

function startMinutes(datetime: PlainDateTime): number {
  return toMinutes(datetime.time)
}

function toMinutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function padTime(time: string): string {
  const [hours, mins] = time.split(':')
  return `${hours.padStart(2, '0')}:${mins}`
}

function durationToMs(duration: string): number {
  const n = ms(duration as ms.StringValue)
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new RangeError(`when: length must be positive, like "70m", "2h" or "45s", got ${describe(duration)}`)
  }
  return n
}

function describe(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

export { When }
