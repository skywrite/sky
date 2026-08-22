/**
 * Minimal Temporal-compatible Duration.
 * Components are hours, minutes, seconds — enough for meetings and time
 * tracking; total() also converts to milliseconds for timer math.
 *
 * Follows the Temporal.Duration API surface where applicable:
 *   - `new Duration(hours, minutes, seconds)`
 *   - `Duration.from('PT1H30M')` / `Duration.from({ minutes: 90 })`
 *   - `.total('minutes')` → number
 *   - `.toString()` → ISO 8601 (e.g. "PT1H30M")
 */

type DurationUnit = 'hours' | 'minutes' | 'seconds' | 'milliseconds'

interface DurationLike {
  hours?: number
  minutes?: number
  seconds?: number
}

export default class Duration {
  public readonly hours: number
  public readonly minutes: number
  public readonly seconds: number

  constructor(hours?: number, minutes?: number, seconds?: number) {
    this.hours = hours ?? 0
    this.minutes = minutes ?? 0
    this.seconds = seconds ?? 0

    for (const [name, val] of [
      ['hours', this.hours],
      ['minutes', this.minutes],
      ['seconds', this.seconds],
    ] as const) {
      if (!Number.isFinite(val)) throw new RangeError(`${name} must be finite`)
      if (!Number.isInteger(val)) throw new RangeError(`${name} must be an integer`)
    }
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  static from(input: Duration | DurationLike | string): Duration {
    if (input instanceof Duration) {
      return new Duration(input.hours, input.minutes, input.seconds)
    }
    if (typeof input === 'string') return Duration.#parseISO(input)
    return new Duration(input.hours, input.minutes, input.seconds)
  }

  /**
   * Parse ISO 8601 duration string. Only the time portion (PT…) is supported.
   * Examples: "PT1H", "PT1H30M", "PT90M", "PT3600S", "PT1H30M15S"
   */
  static #parseISO(text: string): Duration {
    const trimmed = text.trim()
    const match = trimmed.match(/^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
    if (!match || trimmed.toUpperCase() === 'PT') {
      throw new RangeError(`Invalid ISO 8601 duration: "${text}"`)
    }
    const sign = match[1] ? -1 : 1
    const h = match[2] ? Number(match[2]) * sign : 0
    const m = match[3] ? Number(match[3]) * sign : 0
    const s = match[4] ? Number(match[4]) * sign : 0
    return new Duration(h, m, s)
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /** -1, 0, or 1 indicating negative, zero, or positive */
  get sign(): -1 | 0 | 1 {
    const total = this.#totalSeconds()
    if (total < 0) return -1
    if (total > 0) return 1
    return 0
  }

  /** True when every component is zero */
  get blank(): boolean {
    return this.sign === 0
  }

  // ---------------------------------------------------------------------------
  // Arithmetic
  // ---------------------------------------------------------------------------

  /** Return a new Duration whose components are the sum of this and other */
  add(other: Duration | DurationLike): Duration {
    const o = other instanceof Duration ? other : Duration.from(other)
    return new Duration(this.hours + o.hours, this.minutes + o.minutes, this.seconds + o.seconds)
  }

  /** Return a new Duration whose components are this minus other */
  subtract(other: Duration | DurationLike): Duration {
    const o = other instanceof Duration ? other : Duration.from(other)
    return new Duration(this.hours - o.hours, this.minutes - o.minutes, this.seconds - o.seconds)
  }

  /** Negate every component */
  negated(): Duration {
    return new Duration(-this.hours, -this.minutes, -this.seconds)
  }

  /** Absolute value of every component */
  abs(): Duration {
    return new Duration(Math.abs(this.hours), Math.abs(this.minutes), Math.abs(this.seconds))
  }

  // ---------------------------------------------------------------------------
  // Conversion
  // ---------------------------------------------------------------------------

  /** Convert the entire duration to a single unit */
  total(unit: DurationUnit): number {
    const s = this.#totalSeconds()
    switch (unit) {
      case 'milliseconds':
        return s * 1000
      case 'seconds':
        return s
      case 'minutes':
        return s / 60
      case 'hours':
        return s / 3600
    }
  }

  /**
   * Collapse into the largest whole units, e.g. 90 minutes → 1h 30m 0s.
   * Balances components so each is within its natural range.
   */
  balanced(): Duration {
    let totalSecs = this.#totalSeconds()
    const sign = totalSecs < 0 ? -1 : 1
    totalSecs = Math.abs(totalSecs)

    const h = Math.floor(totalSecs / 3600) * sign
    totalSecs %= 3600
    const m = Math.floor(totalSecs / 60) * sign
    const s = (totalSecs % 60) * sign

    return new Duration(h, m, s)
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /** ISO 8601 duration string, e.g. "PT1H30M" */
  toString(): string {
    const balanced = this.balanced()
    const neg = balanced.sign < 0
    const h = Math.abs(balanced.hours)
    const m = Math.abs(balanced.minutes)
    const s = Math.abs(balanced.seconds)

    let out = neg ? '-PT' : 'PT'
    if (h) out += `${h}H`
    if (m) out += `${m}M`
    if (s || (!h && !m)) out += `${s}S`
    return out
  }

  /** JSON serialization → ISO 8601 string */
  toJSON(): string {
    return this.toString()
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  #totalSeconds(): number {
    return this.hours * 3600 + this.minutes * 60 + this.seconds
  }
}

export { Duration }
export type { DurationLike, DurationUnit }
