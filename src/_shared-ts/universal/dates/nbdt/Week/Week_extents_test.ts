import { assert, test } from '#test'
import Week from './mod.ts'

test('Week - mid-year extents', () => {
  const week = Week.of('2026-08-11')

  assert({
    given: '2026-W33 start',
    should: 'be Monday 2026-08-10',
    actual: week.start.ymd,
    expected: '2026-08-10',
  })
  assert({
    given: '2026-W33 end',
    should: 'be Sunday 2026-08-16',
    actual: week.end.ymd,
    expected: '2026-08-16',
  })
  assert({
    given: '2026-W33 days',
    should: 'be the 7 consecutive dates Mon-Sun',
    actual: week.days.map((d) => d.ymd).join(','),
    expected: '2026-08-10,2026-08-11,2026-08-12,2026-08-13,2026-08-14,2026-08-15,2026-08-16',
  })
  assert({
    given: '2026-W33 (mid-year)',
    should: 'have identical true and in-year extents',
    actual: `${week.startInYear.ymd} ${week.endInYear.ymd}`,
    expected: '2026-08-10 2026-08-16',
  })
})

test('Week - W00 extents cross the year line backward', () => {
  const week = Week.of('2027-01-01')

  assert({
    given: '2027-W00 start',
    should: 'be Monday 2026-12-28 (previous calendar year)',
    actual: week.start.ymd,
    expected: '2026-12-28',
  })
  assert({
    given: '2027-W00 stored year vs start.year',
    should: 'differ - year is identity, not derived',
    actual: `${week.year} ${week.start.year}`,
    expected: '2027 2026',
  })
  assert({
    given: '2027-W00 in-year extents',
    should: 'clip to Jan 1 - Jan 3 (the bucket)',
    actual: `${week.startInYear.ymd} ${week.endInYear.ymd}`,
    expected: '2027-01-01 2027-01-03',
  })
})

test('Week - W53 extents cross the year line forward', () => {
  const week = Week.of('2025-12-29')

  assert({
    given: '2025-W53 end',
    should: 'be Sunday 2026-01-04 (next calendar year)',
    actual: week.end.ymd,
    expected: '2026-01-04',
  })
  assert({
    given: '2025-W53 in-year extents',
    should: 'clip to Dec 29 - Dec 31 (the bucket)',
    actual: `${week.startInYear.ymd} ${week.endInYear.ymd}`,
    expected: '2025-12-29 2025-12-31',
  })
})

test('Week - clipped W01 also starts in the previous year', () => {
  const week = Week.of('2026-01-01')

  assert({
    given: '2026-W01 (Jan 1 Thursday) start',
    should: 'be Monday 2025-12-29',
    actual: week.start.ymd,
    expected: '2025-12-29',
  })
  assert({
    given: '2026-W01 startInYear',
    should: 'clip to Jan 1',
    actual: week.startInYear.ymd,
    expected: '2026-01-01',
  })
})

test('Week - boundary pair shares the true week', () => {
  const w53 = Week.of('2026-12-28')
  const w00 = Week.of('2027-01-01')

  assert({
    given: 'W53-2026 and W00-2027',
    should: 'share the same true Monday',
    actual: w53.start.equals(w00.start),
    expected: true,
  })
})

test('Week.contains - bucket membership', () => {
  const fixtures = [
    { week: '2026-08-11', date: '2026-08-16', expected: true, description: 'mid-year, in week' },
    { week: '2026-08-11', date: '2026-08-17', expected: false, description: 'mid-year, next Monday' },
    { week: '2026-12-28', date: '2026-12-31', expected: true, description: 'W53-2026 bucket day' },
    { week: '2026-12-28', date: '2027-01-02', expected: false, description: 'true-week day, but W00-2027 bucket' },
    { week: '2027-01-01', date: '2027-01-02', expected: true, description: 'W00-2027 bucket day' },
  ]

  for (const { week, date, expected, description } of fixtures) {
    assert({
      given: `Week.of(${week}).contains(${date}) (${description})`,
      should: `be ${expected}`,
      actual: Week.of(week).contains(date),
      expected,
    })
  }
})
