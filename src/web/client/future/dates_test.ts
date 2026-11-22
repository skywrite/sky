import { assert, test } from '#test'
import { niceDate, timeLeft } from './dates.ts'

test('niceDate and timeLeft: dates and deadlines as they are said', () => {
  assert({
    given: 'a date this year, a date in another year, and deadlines ahead, today and behind',
    should: 'leave the year off this year, and say how long is left or how far past',
    actual: [
      niceDate('2030-12-31', '2030-06-18'),
      niceDate('2031-01-05', '2030-06-18'),
      [108, 1, 0, -1, -9].map(timeLeft),
    ],
    expected: [
      'Dec 31',
      'Jan 5, 2031',
      ['108 days left', '1 day left', 'Due today', '1 day past its date', '9 days past its date'],
    ],
  })
})
