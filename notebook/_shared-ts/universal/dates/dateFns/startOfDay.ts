import clone from '../clone.ts'

export default function startOfDay(date: Date): Date {
  const d = clone(date)
  d.setHours(0, 0, 0, 0)
  return d
}
