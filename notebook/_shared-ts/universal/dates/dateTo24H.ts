import differenceInCalendarDays from './dateFns/differenceInCalendarDays.ts'

export default function dateTo24H(date: Date, refDate?: Date): string {
  // leaving hour12 as false fucks this
  const dateStr = date.toLocaleString('en-US', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
  if (!refDate) return dateStr

  const dayDelta = differenceInCalendarDays(date, refDate)
  if (dayDelta === 0) return dateStr

  const hourNum = dayDelta * 24 + date.getHours()

  const hours = ('0' + hourNum).slice(-2)
  const mins = ('0' + date.getMinutes()).slice(-2)

  return `${hours}:${mins}`
}
