import { assert, test } from '#test'
import { parseDarwinWakeMs } from './idle.ts'

test('parseDarwinWakeMs reads the last wake, and refuses a reading taken before the wake is stamped', () => {
  const line = (sec: number, usec = 0) => `{ sec = ${sec}, usec = ${usec} } Mon Jun 17 09:30:00 2030\n`
  assert({
    given: 'a sleep and the wake after it, a Mac that never slept, a sleep with no wake yet, and other output',
    should: 'give the wake in epoch milliseconds, zero, and null twice',
    actual: [
      parseDarwinWakeMs(line(1_907_000_000, 250_000) + line(1_907_000_036, 500_999)),
      parseDarwinWakeMs(line(0) + line(0)),
      parseDarwinWakeMs(line(1_907_000_036) + line(1_907_000_000)),
      parseDarwinWakeMs('sysctl: unknown oid\n'),
    ],
    expected: [1_907_000_036_500, 0, null, null],
  })
})
