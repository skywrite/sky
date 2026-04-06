export default function isMonday(date: Date): boolean {
  if (!(date instanceof Date)) {
    throw new Error(`${date} is not a Date.`)
  }

  return date.getDay() === 1
}
