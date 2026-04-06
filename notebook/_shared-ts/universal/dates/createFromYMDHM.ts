import { REGEX_HHMM25_EXACT, REGEX_YMD_SUBSTR } from '#universal/dates/regex/mod.ts'

// NOTE: consider supporting just ymd
// that function is found in ymdToDate()

export default function createFromYMDHM(ymdhm: string): Date {
  const [date, time] = ymdhm.split(' ')
  if (!date || !time) throw new Error(`createFromYMDHM(): ${ymdhm} does not appear to match YYYY-MM-DD HH:MM format.`)

  const matchDate = date.match(REGEX_YMD_SUBSTR)?.groups
  if (!matchDate) throw new Error(`createFromYMDHM: ${date} does not match REGEX_YMD_SUBSTR.`)

  const matchTime = time.match(REGEX_HHMM25_EXACT)?.groups
  if (!matchTime) throw new Error(`createFromYMDHM: ${date} does not match REGEX_HHMM25_EXACT.`)

  const { year, month, day } = matchDate
  const { hour, minute } = matchTime

  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute))
}
