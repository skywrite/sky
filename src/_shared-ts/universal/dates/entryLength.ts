const LENGTH_PART = /^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?![a-z])/
const HOURS_THEN_MINUTES = /^(\d+)\s*(?:hours?|hrs?|h)\s*([0-5]?\d)$/

/** Whole minutes in a typed entry length, including compound and parenthesized forms. */
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

/** Whole hours use `4h`; other lengths use minutes, such as `90m`. */
export function normalizeEntryLength(value: string): string | null {
  const minutes = entryLengthMinutes(value)
  if (minutes === null) return null
  return minutes % 60 ? `${minutes}m` : `${minutes / 60}h`
}
