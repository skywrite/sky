import { assert, test } from '#test'
import { dayOffset } from './WorkstreamsCanvas.tsx'

test({ name: 'workstream timeline - calendar offsets do not shift across DST or year boundaries' }, () => {
  assert({
    given: 'spring and autumn clock changes, leap day, and a year boundary',
    should: 'count calendar days independently of hours and timezone shifts',
    actual: [
      dayOffset('2026-03-07', '2026-03-09'),
      dayOffset('2026-10-31', '2026-11-02'),
      dayOffset('2024-02-28', '2024-03-01'),
      dayOffset('2026-12-31', '2027-01-02'),
      dayOffset('2027-01-02', '2026-12-31'),
    ],
    expected: [2, 2, 2, 2, -2],
  })
})
