import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import { plannedEndAfter } from './plannedEnd.ts'

const START = new PlainDate('2026-07-27')

test(`plannedEndAfter() days and weeks are inclusive`, () => {
  assert({
    given: '30 days from start',
    should: 'track through day 30',
    expected: '2026-08-25',
    actual: plannedEndAfter(START, 30, 'days').ymd,
  })
  assert({
    given: '1 day from start',
    should: 'track only the start day',
    expected: '2026-07-27',
    actual: plannedEndAfter(START, 1, 'days').ymd,
  })
  assert({
    given: '6 weeks from start',
    should: 'track through day 42',
    expected: '2026-09-06',
    actual: plannedEndAfter(START, 6, 'weeks').ymd,
  })
})

test(`plannedEndAfter() months clamp the day and stay inclusive`, () => {
  assert({
    given: '3 months from Jul 27',
    should: 'track through Oct 26',
    expected: '2026-10-26',
    actual: plannedEndAfter(START, 3, 'months').ymd,
  })
  assert({
    given: 'Jan 31 plus one month',
    should: 'clamp to Feb and end the day before',
    expected: '2026-02-27',
    actual: plannedEndAfter(new PlainDate('2026-01-31'), 1, 'months').ymd,
  })
  assert({
    given: 'months crossing a year boundary',
    should: 'roll the year',
    expected: '2027-01-26',
    actual: plannedEndAfter(START, 6, 'months').ymd,
  })
})
