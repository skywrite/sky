import { assert, test } from '#test'
import { startOnSavedDay } from './startOnSavedDay.ts'

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime()

test('startOnSavedDay', () => {
  assert({
    given: 'a transcript that began at 09:00:06 and was saved at 13:40 the same day',
    should: 'start at 09:00 that day',
    actual: startOnSavedDay(local(2026, 1, 27, 13, 40), 9 * 3600 + 6).epochMilliseconds,
    expected: local(2026, 1, 27, 9, 0),
  })
  assert({
    given: 'a transcript that began at 23:30 and was saved at 00:10',
    should: 'start the day before',
    actual: startOnSavedDay(local(2026, 1, 28, 0, 10), 23 * 3600 + 30 * 60).epochMilliseconds,
    expected: local(2026, 1, 27, 23, 30),
  })
  assert({
    given: 'the start as the notebook spells it',
    should: 'read as a day and a time',
    actual: startOnSavedDay(local(2026, 1, 27, 13, 40), 9 * 3600 + 6).plainDateTime.toString(),
    expected: '2026-01-27 09:00',
  })
})
