export default function isLeapYear(year: number): boolean {
  return new Date(year, 1, 29).getDate() === 29
}
