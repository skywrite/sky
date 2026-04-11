/**
 * Convert fractional hours → duration string like "1d 12.23h".
 * - Emits the day segment only when ≥ 24 h
 * - Keeps at most two decimals on the hour part (trims trailing zeros)
 */
export default function hoursToDurationString(hours: number): string {
  // Reject negatives, NaN, and ±Infinity in one shot
  if (!Number.isFinite(hours) || hours < 0) {
    throw new RangeError('hours must be a finite, non-negative number')
  }

  const days = Math.floor(hours / 24)
  const remainder = hours - days * 24
  const rounded = Math.round(remainder * 100) / 100

  let hrs: string | null
  if (rounded === 0) {
    hrs = null
  } else if (rounded % 1 === 0) {
    hrs = String(rounded)
  } else {
    hrs = rounded
      .toFixed(2)
      .replace(/0+$/, '') // trim trailing zeros
      .replace(/\.$/, '') // trim trailing dot
  }

  if (days > 0) {
    return hrs ? `${days}d ${hrs}h` : `${days}d`
  }

  return hrs ? `${hrs}h` : '0h'
}
