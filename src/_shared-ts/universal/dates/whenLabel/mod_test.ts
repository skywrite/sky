import { assert, test } from '#test'
import {
  dayLabel,
  normalizeClock,
  placeDestination,
  placeLabel,
  placeWhere,
  restOfWeek,
  shortDate,
  weekdayName,
} from './mod.ts'

// A fictional week: Wednesday 11 March 2026.
const TODAY = '2026-03-11'

test("whenLabel: a day in a person's words", () => {
  assert({
    given: 'today, tomorrow, a day this week, and a day next week',
    should: 'say Today, Tomorrow, and the short date otherwise',
    actual: [
      dayLabel(TODAY, TODAY),
      dayLabel('2026-03-12', TODAY),
      dayLabel('2026-03-13', TODAY),
      dayLabel('2026-03-16', TODAY),
    ],
    expected: ['Today', 'Tomorrow', 'Fri 13 Mar', 'Mon 16 Mar'],
  })
  assert({
    given: 'a date',
    should: 'name its weekday and short form',
    actual: [weekdayName('2026-03-15'), shortDate('2026-12-31')],
    expected: ['Sunday', 'Thu 31 Dec'],
  })
})

test('whenLabel: the rest of the week', () => {
  assert({
    given: 'a Wednesday',
    should: 'offer Friday through Sunday — today and tomorrow are named on their own',
    actual: restOfWeek(TODAY),
    expected: ['2026-03-13', '2026-03-14', '2026-03-15'],
  })
  assert({
    given: 'a Saturday and a Sunday',
    should: 'offer nothing more — tomorrow is Sunday, or the week is over',
    actual: [restOfWeek('2026-03-14'), restOfWeek('2026-03-15')],
    expected: [[], []],
  })
})

test('whenLabel: where an item lands', () => {
  const created = '2026-03-15'
  assert({
    given: 'timed and untimed days, one beyond the created week, and no day',
    should: 'name the list each is written to',
    actual: [
      placeWhere({ date: '2026-03-12', time: '09:30' }, created),
      placeWhere({ date: '2026-03-12', time: null }, created),
      placeWhere({ date: '2026-03-16', time: '10:00' }, created),
      placeWhere({ date: '2026-03-12', time: null }, null),
      placeWhere({ date: null, time: null }, created),
    ],
    expected: ['Commitments', 'Todos', 'schedule', 'schedule', 'the list'],
  })
  assert({
    given: 'the same placements as labels',
    should: 'read as a chip and as a ledger line',
    actual: [
      placeLabel({ date: '2026-03-13', time: '09:30' }, TODAY),
      placeLabel({ date: '2026-03-12', time: null }, TODAY),
      placeLabel({ date: null, time: null }, TODAY),
      placeDestination({ date: '2026-03-12', time: null }, TODAY, created),
      placeDestination({ date: '2026-03-16', time: '10:00' }, TODAY, created),
      placeDestination({ date: null, time: null }, TODAY, created),
    ],
    expected: ['Fri 13 Mar · 09:30', 'Tomorrow', 'Next', 'Tomorrow · Todos', 'Mon 16 Mar · schedule', 'Next'],
  })
})

test('whenLabel: a typed clock time', () => {
  assert({
    given: 'clock times as people type them',
    should: 'pad the hour, keep extended hours, and refuse what is not a time',
    actual: [
      normalizeClock('9:30'),
      normalizeClock(' 09:05 '),
      normalizeClock('25:30'),
      normalizeClock('9:3'),
      normalizeClock('noon'),
      normalizeClock('9:60'),
    ],
    expected: ['09:30', '09:05', '25:30', '09:03', null, null],
  })
})
