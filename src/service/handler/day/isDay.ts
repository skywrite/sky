import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day in `YYYY-MM-DD` form — `2026-13-45` is not one. */
export default function isDay(ymd: string): boolean {
  if (!YMD.test(ymd)) return false
  try {
    return new PlainDate(ymd).ymd === ymd
  } catch {
    return false
  }
}
