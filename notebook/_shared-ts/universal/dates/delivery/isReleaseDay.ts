import { differenceInCalendarDays } from '#universal/dates/dateFns/mod.ts'

const REFERENCE_DATE = new Date(2020, 11, 3)

export default function isReleaseDay(date: Date) {
  return differenceInCalendarDays(date, REFERENCE_DATE) % 14 === 0
}
