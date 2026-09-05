/** Real UTC wall-clock timestamp, including seconds and milliseconds (not notebook time). */
export function instantNow(): string {
  return Temporal.Now.instant().toString({ smallestUnit: 'millisecond' })
}
