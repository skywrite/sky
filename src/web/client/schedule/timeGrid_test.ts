import { findAvailableTimes, type AvailabilitySearch } from '#lib/calendarScheduler/findTime.ts'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import { assert, test } from '#test'
import { timeGrid } from './timeGrid.ts'

const search: AvailabilitySearch = {
  dates: ['2030-05-06'],
  startTime: '14:00',
  endTime: '15:00',
  timezone: 'UTC',
  displayTimezone: 'UTC',
  bufferMinutes: 0,
  minimumMinutes: 1,
}
const event = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  title: id,
  account: 'jane@example.com',
  start,
  end,
  allDay: false,
  attendees: [],
  eventType: 'default',
  status: 'confirmed',
})
const calendar = async (options: AvailabilitySearch, events: CalendarEvent[] = []) =>
  timeGrid(
    (
      await findAvailableTimes(
        options,
        async () => ({ sources: [{ id: 'work', label: 'Work', events }], warnings: [] }),
        '2030-01-01T00:00:00Z',
      )
    ).days,
  )

test('overlapping grid blocks share width and back-to-back meetings reuse the full column', async () => {
  const timed = (name: string, from: string, to: string) =>
    event(name, `2030-05-06T${from}:00Z`, `2030-05-06T${to}:00Z`)
  const grid = await calendar(search, [
    timed('Studio review', '09:00', '10:00'),
    timed('Project discussion', '09:15', '09:45'),
    timed('Team sync', '09:30', '10:00'),
    timed('Office hours', '10:00', '11:00'),
    timed('First reminder', '12:00', '12:02'),
    timed('Second reminder', '12:02', '12:05'),
  ])
  assert({
    given: 'three overlapping appointments, an adjacent meeting and two very short calendar entries',
    should: 'preserve clock starts and assign separate lanes only while the blocks need the space',
    actual: grid.columns[0]!.blocks.filter(({ entry }) => entry.kind === 'busy').map((b) => [
      b.startMinute,
      b.lane,
      b.laneCount,
    ]),
    expected: [
      [540, 0, 3],
      [555, 1, 3],
      [570, 2, 3],
      [600, 0, 1],
      [720, 0, 2],
      [722, 1, 2],
    ],
  })
})

test('the calendar grid clips overnight ranges to each recipient date and projects daylight changes onto local hours', async () => {
  const overnight = await calendar({
    ...search,
    startTime: '16:00',
    endTime: '18:00',
    timezone: 'America/Chicago',
    displayTimezone: 'Europe/Paris',
  })
  const zone = 'America/New_York'
  const spring = await calendar({
    ...search,
    dates: ['2030-03-10'],
    startTime: '01:30',
    endTime: '04:00',
    timezone: zone,
    displayTimezone: zone,
  })
  const fall = await calendar(
    { ...search, dates: ['2030-11-03'], startTime: '00:00', endTime: '03:00', timezone: zone, displayTimezone: zone },
    [event('Studio review', '2030-11-03T01:45:00-04:00', '2030-11-03T01:15:00-05:00')],
  )
  const spans = (blocks: (typeof spring.columns)[number]['blocks']) => blocks.map((b) => [b.startMinute, b.endMinute])
  assert({
    given: 'midnight, a skipped hour and a meeting across a repeated hour',
    should:
      'draw each visible part in the right column and wall-clock rows, with one selection for the original opening',
    actual: [
      overnight.columns.map(({ blocks }) => spans(blocks)),
      overnight.columns[0]!.blocks[0]!.entry.start === overnight.columns[1]!.blocks[0]!.entry.start,
      spans(spring.columns[0]!.blocks),
      spans(fall.columns[0]!.blocks.filter((b) => b.entry.kind === 'busy')),
    ],
    expected: [
      [[[1380, 1440]], [[0, 60]]],
      true,
      [
        [90, 120],
        [180, 240],
      ],
      [
        [60, 75],
        [105, 120],
      ],
    ],
  })
})
