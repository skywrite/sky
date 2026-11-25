import { assert, test } from '#test'
import { shortDay, weekdayOf } from './dayLabel.ts'

test('day labels come from the calendar date alone', () => {
  assert({
    given: 'dates across a leap day, a year end, and a century',
    should: 'name the month, the day and the weekday',
    actual: [
      [shortDay('2026-11-24'), weekdayOf('2026-11-24')],
      [shortDay('2028-02-29'), weekdayOf('2028-02-29')],
      [shortDay('2027-01-01'), weekdayOf('2027-01-01')],
      [shortDay('2000-03-01'), weekdayOf('2000-03-01')],
      [shortDay('2031-03-17'), weekdayOf('2031-03-17')],
    ],
    expected: [
      ['Nov 24', 'Tue'],
      ['Feb 29', 'Tue'],
      ['Jan 1', 'Fri'],
      ['Mar 1', 'Wed'],
      ['Mar 17', 'Mon'],
    ],
  })
})
