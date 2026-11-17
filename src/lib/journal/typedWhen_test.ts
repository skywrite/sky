import { assert, test } from '#test'
import { typedWhen } from './typedWhen.ts'

test('a typed journal time is read the way the notebook writes it', () => {
  assert({
    given: 'a date and time, a single-digit hour with extra spaces, and a time past midnight',
    should: 'keep each as the notebook writes it',
    actual: [typedWhen('2031-03-12 07:45'), typedWhen('  2031-03-12   9:05 '), typedWhen('2031-03-12 25:10')],
    expected: ['2031-03-12 07:45', '2031-03-12 09:05', '2031-03-12 25:10'],
  })
  assert({
    given: 'a day missing from the calendar, a date with no time, words, and no text at all',
    should: 'refuse each',
    actual: [typedWhen('2031-02-30 08:00'), typedWhen('2031-03-12'), typedWhen('Thursday'), typedWhen(undefined)],
    expected: [null, null, null, null],
  })
})
