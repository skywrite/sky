import type { AvailabilityDay, AvailabilityEntry } from '#lib/calendarScheduler/findTime.ts'

export type CalendarEventEntry = Exclude<AvailabilityEntry, { kind: 'free' }>

// Leave room for one readable line and a click target even for a one-minute opening.
export const minimumBlockMinutes = 15

interface ClockSpan {
  startMinute: number
  endMinute: number
}

interface TimedBlock extends ClockSpan {
  entry: AvailabilityEntry
  lane: number
  laneCount: number
}

// Clip to this date, then project onto its wall clock. At a fall-back, two instants can cover the same clock minutes.
function clockSpans(entry: AvailabilityEntry, periods: AvailabilityDay['clockPeriods']): ClockSpan[] {
  const spans: ClockSpan[] = []
  for (const period of periods) {
    const start = Math.max(entry.start, period.start)
    const end = Math.min(entry.end, period.end)
    if (start >= end) continue
    spans.push({
      startMinute: period.startMinute + (start - period.start) / 60_000,
      endMinute: period.startMinute + (end - period.start) / 60_000,
    })
  }
  spans.sort((a, b) => a.startMinute - b.startMinute)
  const merged: ClockSpan[] = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, span.endMinute)
    else merged.push(span)
  }
  return merged
}

function layoutDay(day: AvailabilityDay) {
  const allDay: CalendarEventEntry[] = []
  const blocks: TimedBlock[] = []
  for (const entry of day.entries) {
    if (entry.kind !== 'free' && entry.allDay) allDay.push(entry)
    else for (const span of clockSpans(entry, day.clockPeriods)) blocks.push({ ...span, entry, lane: 0, laneCount: 1 })
  }
  blocks.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)
  const ends: number[] = []
  let groupStart = 0
  const finishGroup = (until: number) => {
    for (let i = groupStart; i < until; i++) blocks[i]!.laneCount = ends.length
    groupStart = until
    ends.length = 0
  }
  for (const [i, block] of blocks.entries()) {
    if (ends.every((end) => end <= block.startMinute)) finishGroup(i)
    const vacant = ends.findIndex((end) => end <= block.startMinute)
    block.lane = vacant === -1 ? ends.length : vacant
    ends[block.lane] = Math.max(block.endMinute, block.startMinute + minimumBlockMinutes)
  }
  finishGroup(blocks.length)
  return { day, allDay, blocks }
}

export function timeGrid(days: AvailabilityDay[]) {
  const columns = days.map(layoutDay)
  let firstHour = 24
  let lastHour = 0
  for (const { blocks } of columns) {
    for (const block of blocks) {
      firstHour = Math.min(firstHour, Math.floor(block.startMinute / 60))
      lastHour = Math.max(lastHour, Math.ceil(block.endMinute / 60))
    }
  }
  const hourCount = Math.max(0, lastHour - firstHour)
  const hours = hourCount ? Array.from({ length: hourCount + 1 }, (_, i) => firstHour + i) : []
  return { columns, hours, firstHour, hourCount, hasAllDay: columns.some(({ allDay }) => allDay.length > 0) }
}
