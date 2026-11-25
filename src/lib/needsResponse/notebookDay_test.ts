import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { calendarDayOf, createDayResolver } from './notebookDay.ts'

const at = (iso: string) => Instant.from(iso).epochMilliseconds

test('a notebook day runs from its start until the next day is started', () => {
  // Monday started at 08:00, Tuesday at 09:00. Wednesday was never started. Thursday started at 07:30.
  const started: Record<string, string> = {
    '2031-03-17': '2031-03-17T08:00:00Z',
    '2031-03-18': '2031-03-18T09:00:00Z',
    '2031-03-20': '2031-03-20T07:30:00Z',
  }
  const reads: string[] = []
  const dayOf = createDayResolver({
    timezone: 'UTC',
    startOf: (date) => {
      reads.push(date)
      return started[date] ? at(started[date]) : null
    },
  })

  assert({
    given: 'replies through three started days and one that never was',
    should: 'count each for the day that was open when it went out',
    actual: {
      mondayAfternoon: dayOf(at('2031-03-17T15:00:00Z')),
      pastMidnight: dayOf(at('2031-03-18T00:30:00Z')),
      beforeTuesdayStarted: dayOf(at('2031-03-18T08:59:00Z')),
      afterTuesdayStarted: dayOf(at('2031-03-18T09:00:00Z')),
      onTheDayNeverStarted: dayOf(at('2031-03-19T14:00:00Z')),
      thursdayMorning: dayOf(at('2031-03-20T07:45:00Z')),
    },
    expected: {
      mondayAfternoon: '2031-03-17',
      pastMidnight: '2031-03-17',
      beforeTuesdayStarted: '2031-03-17',
      afterTuesdayStarted: '2031-03-18',
      onTheDayNeverStarted: '2031-03-18',
      thursdayMorning: '2031-03-20',
    },
  })

  assert({
    given: 'six lookups over four calendar dates',
    should: 'read each day file once',
    actual: reads.toSorted(),
    expected: ['2031-03-17', '2031-03-18', '2031-03-19', '2031-03-20'],
  })

  assert({
    given: 'a host with no notebook days, and a notebook where nothing was ever started',
    should: 'fall back to the calendar date',
    actual: [
      calendarDayOf('UTC')(at('2031-03-18T00:30:00Z')),
      createDayResolver({ timezone: 'UTC', startOf: () => null })(at('2031-03-18T00:30:00Z')),
    ],
    expected: ['2031-03-18', '2031-03-18'],
  })
})
