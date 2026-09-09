import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { StreakView } from '../../streaks/types.ts'

export type StreakScope = 'month' | 'quarter' | 'year'
export type StreakDayState = 'done' | 'missed' | 'pending' | 'off' | 'future'
export const streakDayLabels: Record<StreakDayState, string> = {
  done: 'Completed',
  missed: 'Not recorded',
  pending: 'Today · open',
  off: 'Not scheduled',
  future: 'Upcoming',
}
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function streakMonth(value: string | null, fallback: string): string {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    try {
      return new PlainDate(`${value}-01`).ymd.slice(0, 7)
    } catch {
      /* Use the notebook's current month for an invalid URL. */
    }
  }
  return fallback.slice(0, 7)
}

export function shiftStreakMonth(month: string, amount: number): string {
  const first = new PlainDate(`${month}-01`)
  const index = first.year * 12 + first.month - 1 + amount
  return new PlainDate(Math.floor(index / 12), (index % 12) + 1, 1).ymd.slice(0, 7)
}

export function streakMonthDays(month: string): PlainDate[] {
  const first = new PlainDate(`${month}-01`)
  return Array.from({ length: first.daysInMonth }, (_, index) => first.addDays(index))
}

export function streakPeriod(month: string, scope: StreakScope) {
  const date = new PlainDate(`${month}-01`)
  const offset = scope === 'year' ? date.month - 1 : scope === 'quarter' ? (date.month - 1) % 3 : 0
  const first = shiftStreakMonth(month, -offset)
  const size = scope === 'year' ? 12 : scope === 'quarter' ? 3 : 1
  const months = Array.from({ length: size }, (_, index) => shiftStreakMonth(first, index))
  return {
    first,
    anchor: month,
    months,
    size,
    last: months[months.length - 1],
    days: months.flatMap(streakMonthDays),
    label:
      scope === 'year'
        ? String(date.year)
        : scope === 'quarter'
          ? `Q${Math.ceil(date.month / 3)} · ${date.year}`
          : `${monthNames[date.month - 1]} ${date.year}`,
  }
}
export type StreakPeriod = ReturnType<typeof streakPeriod>

export function streakTracked(streak: StreakView, date: PlainDate): boolean {
  return (
    !!streak.start &&
    date.ymd >= streak.start &&
    (!streak.end || date.ymd <= streak.end) &&
    (streak.schedule === 'daily' || date.dayOfWeek <= 5)
  )
}

export function streakDayState(streak: StreakView, date: PlainDate, today: string): StreakDayState {
  if (!streakTracked(streak, date)) return 'off'
  if (date.ymd > today) return 'future'
  if (streak.done.includes(date.ymd)) return 'done'
  return date.ymd === today ? 'pending' : 'missed'
}

export function streakPeriodSummary(streak: StreakView, days: PlainDate[], today: string) {
  const completed = new Set(streak.done)
  let total = 0,
    done = 0
  for (const date of days) {
    if (!streakTracked(streak, date) || date.ymd > today || (date.ymd === today && !completed.has(today))) continue
    total++
    if (completed.has(date.ymd)) done++
  }
  return { done, total, percent: total ? Math.round((done / total) * 100) : null }
}

export function streakEmptyPeriod(streak: StreakView, days: PlainDate[], today: string): string {
  if (!streak.start) return 'Add a start date in the streak document'
  if (days.some((date) => streakTracked(streak, date) && date.ymd === today)) return 'Today is still open'
  if (days.some((date) => streakTracked(streak, date) && date.ymd > today)) return 'Upcoming · no recorded days yet'
  return 'No scheduled days in this period'
}
