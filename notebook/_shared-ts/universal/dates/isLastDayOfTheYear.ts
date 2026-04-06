export default function isLastDayOfTheYear(date: Date): boolean {
  return date.getDate() === 31 && date.getMonth() === 11
}
