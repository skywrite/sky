/**
 * Slack message timestamps are `seconds.micros` strings. Comparing them as
 * numbers loses the last digits once seconds reach ten digits, so they are
 * ordered as what they are: integer seconds, then integer microseconds.
 */
export function compareTs(a: string, b: string): number {
  const [aSeconds = '', aMicros = ''] = a.split('.')
  const [bSeconds = '', bMicros = ''] = b.split('.')
  const width = Math.max(aSeconds.length, bSeconds.length)
  const seconds = aSeconds.padStart(width, '0').localeCompare(bSeconds.padStart(width, '0'))
  if (seconds !== 0) return seconds
  return aMicros.padEnd(6, '0').localeCompare(bMicros.padEnd(6, '0'))
}

/** Epoch seconds as a Slack ts string. */
export function toTs(seconds: number): string {
  return seconds.toFixed(6)
}

/** The ts one microsecond before this one: the newest cursor that still lets a feed return it. */
export function justBefore(ts: string): string {
  const [seconds, micros = '000000'] = ts.split('.')
  let s = Number(seconds)
  let m = Number(micros.padEnd(6, '0').slice(0, 6)) - 1
  if (m < 0) {
    m = 999999
    s -= 1
  }
  return `${s}.${String(m).padStart(6, '0')}`
}
