import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { checkinDayRange } from './checkinContext.ts'

const WEEK = Week.from(2026, 10) // Mon 2026-03-02 – Sun 2026-03-08

test('checkinDayRange - mid-week includes today', () => {
  // Checking in on Tuesday: Monday's full record plus today's partial one
  const days = checkinDayRange(WEEK, new PlainDate(2026, 3, 3))

  assert({
    given: 'the current week on Tuesday',
    should: 'span Monday through today inclusive',
    actual: `${days.length}: ${days[0].ymd} .. ${days[days.length - 1].ymd}`,
    expected: '2: 2026-03-02 .. 2026-03-03',
  })
})

test('checkinDayRange - Monday of the week is a single partial day', () => {
  const days = checkinDayRange(WEEK, new PlainDate(2026, 3, 2))

  assert({
    given: 'a checkin on the target Monday itself',
    should: 'contribute just that day',
    actual: `${days.length}: ${days[0].ymd}`,
    expected: '1: 2026-03-02',
  })
})

test('checkinDayRange - completed week contributes all seven days', () => {
  const days = checkinDayRange(WEEK, new PlainDate(2026, 3, 12))

  assert({
    given: 'a checkin run the Thursday after the week ended',
    should: 'span the full Mon–Sun run',
    actual: `${days.length}: ${days[0].ymd} .. ${days[days.length - 1].ymd}`,
    expected: '7: 2026-03-02 .. 2026-03-08',
  })
})

test('checkinDayRange - a week that has not started contributes nothing', () => {
  const days = checkinDayRange(WEEK, new PlainDate(2026, 2, 25))

  assert({
    given: 'today before the target week starts',
    should: 'return no days',
    actual: days.length,
    expected: 0,
  })
})
