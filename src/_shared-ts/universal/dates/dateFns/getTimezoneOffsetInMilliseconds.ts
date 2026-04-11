export default function getTimezoneOffsetInMilliseconds(date: Date): number {
  const utcDate = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds(),
    ),
  )
  utcDate.setUTCFullYear(date.getFullYear())
  return date.getTime() - utcDate.getTime()
}
