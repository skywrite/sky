export default function addHours(date: Date, hours: number): Date {
  const milliseconds = hours * 60 * 60 * 1000
  return new Date(date.getTime() + milliseconds)
}
