import { assert, test } from '#test'
import hoursBetween from './hoursBetween.ts'

test(hoursBetween.name, () => {
  const cases = [
    {
      given: 'same-day span',
      start: new Date('2025-07-19T09:33:00-05:00'),
      end: new Date('2025-07-19T17:33:00-05:00'),
      expected: 8,
    },
    {
      given: 'crosses midnight',
      start: new Date('2025-07-19T09:33:00-05:00'),
      end: new Date('2025-07-20T08:33:00-05:00'),
      expected: 23,
    },
    {
      given: 'handles DST spring-forward',
      start: new Date('2025-03-08T09:00:00-05:00'),
      end: new Date('2025-03-09T09:00:00-04:00'),
      expected: 23,
    },
    {
      given: 'spans multiple days across month boundary with fractional hours',
      start: new Date('2025-07-30T09:15:00-05:00'),
      end: new Date('2025-08-02T09:45:00-05:00'),
      expected: 72.5, // 3 days = 72 h + 30 min = 0.5 h
    },
    {
      given: 'handles DST fall-back',
      // U.S. DST ends at 02:00 on 2025-11-02, clock reverts to 01:00 (-04:00 → -05:00)
      start: new Date('2025-11-01T09:00:00-04:00'),
      end: new Date('2025-11-02T09:00:00-05:00'),
      expected: 25, // 24 h + the extra hour gained overnight
    },
  ]

  cases.forEach(({ given, start, end, expected }) =>
    assert({
      given,
      should: `return ${expected}`,
      actual: hoursBetween(start, end),
      expected,
    }),
  )
})
