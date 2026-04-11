export default function isFirstDayOfTheYear(date: Date): boolean {
  return date.getDate() === 1 && date.getMonth() === 0
}
