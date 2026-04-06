/**
 * Convert a duration string (e.g. "1d 12.25h", "7h", "365d")
 * back to a fractional‑hours number.
 *
 * Accepted patterns (case‑insensitive, surrounding spaces ignored):
 *   – "<days>d <hours>h"    (days integer, hours decimal/whole)
 *   – "<days>d"             (days only)
 *   – "<hours>h"            (hours only)
 *
 * Throws RangeError on invalid input.
 */
export default function durationStringToHours(text: string): number {
  if (typeof text !== 'string') {
    throw new RangeError('input must be a string')
  }

  const trimmed = text.trim().toLowerCase()
  if (trimmed === '') {
    throw new RangeError('empty string')
  }

  const token = /(\d+(?:\.\d+)?)([dh])/g
  let match
  let days = 0
  let hours = 0
  let found = false // track whether we saw at least one token

  while ((match = token.exec(trimmed))) {
    found = true
    const value = parseFloat(match[1])
    if (!Number.isFinite(value)) {
      throw new RangeError('non‑finite number')
    }

    if (match[2] === 'd') days += value
    else hours += value
  }

  // anything left over => invalid characters / units
  const leftover = trimmed.replace(token, '').replace(/\s+/g, '')
  if (leftover !== '') {
    throw new RangeError(`invalid duration format: "${text}"`)
  }
  if (!found) {
    throw new RangeError('no duration units found')
  }

  // round to avoid IEEE‑754 crumbs
  return Math.round((days * 24 + hours) * 1e10) / 1e10
}
