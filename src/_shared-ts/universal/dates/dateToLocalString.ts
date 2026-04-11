import ymd from '#universal/dates/ymd.ts'
import dateTo24H from '#universal/dates/dateTo24H.ts'
import tzOffset from './timezones/timezoneOffset.ts'

export default function dateToLocalString(date: Date): string {
  const YMD = ymd(date).join('-')
  const time = dateTo24H(date)
  const tzo = tzOffset(date)

  let tzoStr = String(tzo)
  if (tzo >= 0) {
    tzoStr = '+' + tzoStr
  }

  return `${YMD} ${time} UTC${tzoStr}`
}
