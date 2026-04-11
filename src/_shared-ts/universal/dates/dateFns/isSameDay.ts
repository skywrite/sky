import startOfDay from './startOfDay.ts'

export default function isSameDay(date1: Date, date2: Date): boolean {
  const dateLeftStartOfDay = startOfDay(date1)
  const dateRightStartOfDay = startOfDay(date2)

  return dateLeftStartOfDay.getTime() === dateRightStartOfDay.getTime()
}
