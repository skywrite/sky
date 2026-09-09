import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { Tracker, TrackingEntry } from './types.ts'

const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

export function numericValue(value: string | undefined): number | null {
  if (!value?.trim() || !NUMBER.test(value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Duration CSVs store a number in their declared unit, never an assumed unit. */
function minutesPerUnit(unit = ''): number | null {
  const normalized = unit.trim().toLowerCase()
  if (['', 'h', 'hr', 'hrs', 'hour', 'hours'].includes(normalized)) return 60
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(normalized)) return 1
  if (['s', 'sec', 'secs', 'second', 'seconds'].includes(normalized)) return 1 / 60
  return null
}

export function normalizeTrackingValue(column: TrackingColumn, input: string): string {
  const value = input.trim()
  if (/[\r\n\0]/.test(value)) throw new Error(`${column.name} must fit on one line.`)
  if (!value) return ''
  if (column.type === 'number') {
    if (numericValue(value) === null) throw new Error(`Enter a number for ${column.name}.`)
  } else if (column.type === 'duration') {
    const scalar = numericValue(value)
    if (scalar !== null && scalar >= 0) return value
    const unit = minutesPerUnit(column.unit)
    const duration = value
      .toLowerCase()
      .match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?$/)
    const clock = value.match(/^(\d+):([0-5]\d)$/)
    const minutes = clock
      ? Number(clock[1]) * 60 + Number(clock[2])
      : duration && (duration[1] || duration[2])
        ? Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)
        : null
    if (minutes === null || unit === null)
      throw new Error(`Enter a duration in ${column.unit || 'hours'} for ${column.name}.`)
    return String(Number((minutes / unit).toFixed(8)))
  } else if (column.type === 'time' && !/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new Error(`Use H:MM for ${column.name}. Extended hours such as 25:30 are supported.`)
  }
  return value
}

export function formatTrackingValue(column: TrackingColumn, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = numericValue(value)
  if (column.type === 'duration' && n !== null) {
    const unit = minutesPerUnit(column.unit)
    if (unit !== null) {
      if (unit === 1 / 60 || (n !== 0 && Math.abs(n * unit) < 1)) {
        const seconds = Number((n * unit * 60).toFixed(2))
        return `${seconds.toLocaleString('en-US', { maximumFractionDigits: 2 })}s`
      }
      const minutes = Math.round(n * unit)
      if (minutes < 60) return `${minutes}m`
      return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')}m` : ''}`
    }
  }
  if (column.type === 'number' || column.type === 'duration') {
    return `${n === null ? value : n.toLocaleString('en-US', { maximumFractionDigits: 4 })}${column.unit ? ` ${column.unit}` : ''}`
  }
  return value
}

export function primaryTrackingColumn(tracker: Tracker): TrackingColumn | undefined {
  return (
    tracker.columns.find((c) => c.type === 'number' || c.type === 'duration') ??
    tracker.columns.find((c) => c.name !== 'notes' && c.type !== 'time') ??
    tracker.columns[0]
  )
}

export interface TrackingPoint {
  date: string
  value: number | null
  text: string | null
  count: number
}

export function trackingSeries(
  entries: TrackingEntry[],
  column: TrackingColumn,
  start: string,
  end: string,
): TrackingPoint[] {
  const byDay = new Map<string, string[]>()
  for (const entry of entries) {
    const value = entry.values[column.name]
    if (value?.trim()) byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), value])
  }
  const points: TrackingPoint[] = []
  for (let day = new PlainDate(start); day.ymd <= end; day = day.addDays(1)) {
    const values = byDay.get(day.ymd) ?? []
    const aggregate = column.aggregate ?? 'last'
    let text: string | null = values.at(-1) ?? null
    if (aggregate === 'collect') text = values.length ? values.join(' · ') : null
    if (aggregate === 'sum' || aggregate === 'mean') {
      const numbers = values.map(numericValue).filter((n): n is number => n !== null)
      text = numbers.length
        ? String(numbers.reduce((a, b) => a + b, 0) / (aggregate === 'mean' ? numbers.length : 1))
        : null
    }
    points.push({
      date: day.ymd,
      text,
      value: aggregate === 'collect' ? null : numericValue(text ?? undefined),
      count: values.length,
    })
  }
  return points
}

export function trackingSummary(
  points: TrackingPoint[],
  column: TrackingColumn,
): { value: string | null; label: string; days: number; average: string | null } {
  const recorded = points.filter((p) => p.count > 0)
  const numbers = points.flatMap((p) => (p.value === null ? [] : [p.value]))
  const average =
    numbers.length && ['number', 'duration'].includes(column.type)
      ? String(numbers.reduce((a, b) => a + b, 0) / numbers.length)
      : null
  let value = recorded.at(-1)?.text ?? null
  let label = 'Latest entry'
  if (column.aggregate === 'sum') {
    value = numbers.length ? String(numbers.reduce((a, b) => a + b, 0)) : null
    label = 'Total in this range'
  } else if (column.aggregate === 'mean' || (column.type === 'duration' && column.aggregate !== 'collect')) {
    value = average
    label = 'Daily average'
  }
  return { value, label, days: recorded.length, average }
}

export function isTrackingDay(tracker: Tracker, date: string): boolean {
  return (
    !!tracker.start &&
    date >= tracker.start &&
    (!tracker.end || date <= tracker.end) &&
    tracker.schedule !== 'manual' &&
    (tracker.schedule !== 'weekdays' || new PlainDate(date).dayOfWeek <= 5)
  )
}
