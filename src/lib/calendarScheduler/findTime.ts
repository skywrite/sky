import { z } from 'zod'
import {
  calendarDayStart,
  calendarInstant,
  calendarInterval,
  Instant,
  instantNow,
  PlainDate,
  PlainDateTime,
} from '#universal/dates/nbdt/mod.ts'
import {
  attendsCalendarEvent,
  blocksCalendarTime,
  type CalendarReadSource,
  preferCalendarTitle,
} from './availability.ts'
import type { CalendarSchedulerHost } from './types.ts'

const civilTime = /^([01]\d|2[0-3]):[0-5]\d$/
export const startMinutesSchema = z.array(z.number().int().min(0).max(59)).max(60)
export const availabilityZone = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      return true
    } catch {
      return false
    }
  }, 'Choose a valid time zone.')

export const searchSchema = z
  .object({
    dates: z.array(z.iso.date()).min(1, 'Which days should Sky check?').max(31, 'Choose up to 31 days per search.'),
    startTime: z.string().regex(civilTime, 'Choose a start time.'),
    endTime: z.string().regex(/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Choose an end time.'),
    timezone: availabilityZone,
    displayTimezone: availabilityZone,
    bufferMinutes: z.number().int().min(0).max(1440),
    minimumMinutes: z.number().int().min(1).max(1440),
    startMinutes: startMinutesSchema
      .transform((marks) => {
        const minutes = [...new Set(marks)].sort((a, b) => a - b)
        return minutes.length === 60 ? [] : minutes
      })
      .optional(),
  })
  .refine((value) => value.endTime > value.startTime, 'Choose an end time after the start time.')

export type AvailabilitySearch = z.infer<typeof searchSchema>
export const windowsSchema = searchSchema.safeExtend({
  disabledCalendars: z.array(z.string().min(1)).optional(),
  ignoredEvents: z.array(z.string().min(1)).optional(),
})
export type AvailabilityCalendar = Pick<CalendarReadSource, 'id' | 'label'>
export interface AvailabilityResult {
  calendars: AvailabilityCalendar[]
  days: AvailabilityDay[]
}
export interface TimeRange {
  start: number
  end: number
}
interface CalendarOccurrence extends TimeRange {
  id: string
  title: string
  calendarLabels: string[]
  busy: boolean
  allDay: { start: string; end: string } | null
}
export type AvailabilityEntry = TimeRange & { label: string } & (
    | { kind: 'free'; continued: boolean }
    | { kind: 'busy' | 'ignored' | 'nonblocking'; id: string; title: string; allDay: boolean; calendarLabels: string[] }
  )
export interface AvailabilityDay {
  date: string
  label: string
  weekday: string
  monthDay: string
  clockPeriods: (TimeRange & { startMinute: number })[]
  entries: AvailabilityEntry[]
  warnings: string[]
}

const MINUTE = 60_000
const wire = (ms: number) => Instant.fromEpochMilliseconds(ms).toString()

function wallTime(date: string, time: string, zone: string): number {
  if (time === '24:00') return calendarDayStart(new PlainDate(date).addDays(1).ymd, zone)
  try {
    return calendarInterval(new PlainDateTime({ date, time }), zone, 1).startMilliseconds
  } catch {
    throw new Error(`Choose another boundary for ${date} at ${time} in ${zone}. The clock changes at this time.`)
  }
}

function calendarOccurrences(sources: CalendarReadSource[], zone: string): CalendarOccurrence[] {
  const byId = new Map<string, CalendarOccurrence>()
  for (const source of sources) {
    for (const event of source.events) {
      if (!attendsCalendarEvent(event)) continue
      const start = event.allDay ? calendarDayStart(event.start, zone) : calendarInstant(event.start)
      const end = event.allDay ? calendarDayStart(event.end, zone) : calendarInstant(event.end)
      const identity = event.iCalUid ?? JSON.stringify([event.calendarId ?? source.id, event.id])
      const id = `${identity}/${event.allDay ? event.start : start}`
      const busy = blocksCalendarTime(event)
      const previous = byId.get(id)
      if (previous) {
        previous.title = preferCalendarTitle(previous.title, event.title)
        if (!previous.calendarLabels.includes(source.label)) previous.calendarLabels.push(source.label)
        // A transparent copy cannot extend the time blocked by a busy copy.
        if ((!previous.busy && busy) || (previous.busy === busy && end > previous.end)) {
          previous.busy = busy
          previous.end = end
          if (previous.allDay) previous.allDay.end = event.end
        }
        continue
      }
      byId.set(id, {
        id,
        title: event.title.trim(),
        calendarLabels: [source.label],
        start,
        end,
        busy,
        allDay: event.allDay ? { start: event.start, end: event.end } : null,
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
}

function openings(window: TimeRange, events: TimeRange[], search: AvailabilitySearch, now: number): TimeRange[] {
  const free: TimeRange[] = []
  const pad = search.bufferMinutes * MINUTE
  const marks = new Set(search.startMinutes)
  let cursor = Math.ceil(Math.max(window.start, now) / MINUTE) * MINUTE
  const offerUntil = (until: number) => {
    const end = Math.floor(Math.min(until, window.end) / MINUTE) * MINUTE
    const latestStart = end - search.minimumMinutes * MINUTE
    // Walk real minutes so skipped or repeated clock times and fractional-hour display zones stay accurate.
    for (let start = cursor; start <= latestStart; start += MINUTE) {
      if (
        marks.size &&
        !marks.has(Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(search.displayTimezone).minute)
      )
        continue
      free.push({ start, end })
      break
    }
  }
  // Advancing past the furthest buffered end merges overlaps for availability while preserving each agenda event.
  for (const event of events) {
    if (event.start - pad >= window.end) break
    if (event.end + pad <= cursor) continue
    offerUntil(event.start - pad)
    cursor = Math.max(cursor, Math.ceil((event.end + pad) / MINUTE) * MINUTE)
  }
  offerUntil(window.end)
  return free
}

function displayDays(windows: TimeRange[], zone: string): Map<string, TimeRange> {
  const days = new Map<string, TimeRange>()
  for (const window of windows) {
    let day = Instant.fromEpochMilliseconds(window.start).toZonedDateTimeISO(zone).startOfDay()
    while (day.epochMilliseconds < window.end) {
      const next = day.add({ days: 1 }).startOfDay()
      days.set(day.toPlainDate().toString(), { start: day.epochMilliseconds, end: next.epochMilliseconds })
      day = next
    }
  }
  return days
}

// Each offset period advances uniformly on the display clock, including on 23- and 25-hour days.
function dayClock(day: TimeRange, zone: string): AvailabilityDay['clockPeriods'] {
  const periods: AvailabilityDay['clockPeriods'] = []
  let start = day.start
  while (start < day.end) {
    const local = Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(zone)
    const next = local.getTimeZoneTransition('next')
    const end = Math.min(next?.epochMilliseconds ?? day.end, day.end)
    periods.push({ start, end, startMinute: local.hour * 60 + local.minute + local.second / 60 })
    start = end
  }
  return periods
}

/** Search in the organizer's civil time. Group and label the offers by the date the recipient actually sees. */
export async function findAvailableTimes(
  search: z.infer<typeof windowsSchema>,
  read: NonNullable<CalendarSchedulerHost['readCalendars']>,
  now = instantNow(),
): Promise<AvailabilityResult> {
  const disabled = new Set(search.disabledCalendars)
  const ignored = new Set(search.ignoredEvents)
  const calendars = new Map<string, AvailabilityCalendar>()
  const dates = [...new Set(search.dates)].sort()
  const groups: string[][] = []
  for (const date of dates) {
    const previous = groups.at(-1)
    // Nearby dates share one provider read. Distant alternatives need no intervening months of events.
    if (previous && date <= new PlainDate(previous.at(-1)!).addDays(2).ymd) previous.push(date)
    else groups.push([date])
  }

  const zone = search.displayTimezone
  const dayFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
  const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' })
  const monthDayFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'long', day: 'numeric' })
  const timeLabel = (ms: number) => timeFormat.format(ms).toLowerCase().replace(':00', '').replace(/\s+/g, ' ')
  const local = (ms: number) => Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)
  const rangeLabel = (range: TimeRange, columnDate: string) => {
    const start = local(range.start)
    const end = local(range.end)
    const startDate = start.toPlainDate().toString()
    const endDate = end.toPlainDate().toString()
    let from = timeLabel(range.start)
    let to = timeLabel(range.end)
    if (start.offset !== end.offset) {
      from += ` (UTC${start.offset})`
      to += ` (UTC${end.offset})`
    } else if (startDate === endDate && from.slice(-2) === to.slice(-2)) from = from.slice(0, -3)
    if (startDate !== columnDate) from = `${dayFormat.format(range.start)} ${from}`
    if (endDate !== columnDate) to = `${dayFormat.format(range.end)} ${to}`
    return `${from}–${to}`
  }

  const days: AvailabilityDay[] = []
  const nowMs = calendarInstant(now)
  for (const group of groups) {
    const windows = group.map((date) => ({
      start: wallTime(date, search.startTime, search.timezone),
      end: wallTime(date, search.endTime, search.timezone),
    }))
    const dayBounds = displayDays(windows, zone)
    const bounds = [...dayBounds.values()]
    // All-day dates can come from calendars in other zones. Nearby meetings can also buffer into these days.
    const margin = (1440 + search.bufferMinutes) * MINUTE
    const { sources, warnings } = await read(
      wire(bounds[0]!.start - margin),
      wire(bounds.at(-1)!.end + margin),
      search.timezone,
      disabled,
    )
    for (const { id, label } of sources) calendars.set(id, { id, label })
    const enabled = sources.filter((source) => !disabled.has(source.id))
    const issues = warnings.concat(enabled.flatMap((source) => source.warning ?? []))
    if (!sources.length && !issues.length) issues.push('No connected calendars could be checked.')
    const events = calendarOccurrences(enabled, search.timezone)
    const counted = events.filter((event) => event.busy && !ignored.has(event.id))
    const free = issues.length ? [] : windows.flatMap((window) => openings(window, counted, search, nowMs))
    for (const [date, day] of dayBounds) {
      const entries: AvailabilityEntry[] = []
      for (const event of events) {
        // Google's all-day entries keep their civil dates across display zones.
        const visible = event.allDay
          ? event.allDay.start <= date && date < event.allDay.end
          : event.start < day.end && event.end > day.start
        if (visible)
          entries.push({
            kind: !event.busy ? 'nonblocking' : ignored.has(event.id) ? 'ignored' : 'busy',
            id: event.id,
            title: event.title || 'Untitled event',
            calendarLabels: event.calendarLabels,
            start: event.start,
            end: event.end,
            allDay: !!event.allDay,
            label: event.allDay ? 'All day' : rangeLabel(event, date),
          })
      }
      for (const range of free) {
        if (range.start < day.end && range.end > day.start)
          entries.push({ ...range, kind: 'free', label: rangeLabel(range, date), continued: range.start < day.start })
      }
      const allDay = (entry: AvailabilityEntry) => entry.kind !== 'free' && entry.allDay
      entries.sort((a, b) => Number(allDay(b)) - Number(allDay(a)) || a.start - b.start)
      days.push({
        date,
        label: dayFormat.format(day.start),
        weekday: weekdayFormat.format(day.start),
        monthDay: monthDayFormat.format(day.start),
        clockPeriods: dayClock(day, zone),
        entries,
        warnings: issues,
      })
    }
  }
  return { days, calendars: [...calendars.values()].sort((a, b) => a.label.localeCompare(b.label)) }
}
