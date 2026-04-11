import { REGEX_YMD_SUBSTR } from '#universal/dates/regex/mod.ts'

export default function ymdToDate(ymd: string): Date {
  const match = ymd.match(REGEX_YMD_SUBSTR)?.groups
  if (!match) throw new Error(`ymdToDate: ${ymd} does not match REGEX_YMD_LOOSE.`)

  const { year, month, day } = match
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
}
