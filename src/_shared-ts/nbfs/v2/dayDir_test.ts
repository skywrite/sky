import { assert, test } from '#test'
import dayDir from './dayDir.ts'

test('dayDir - normal dates', () => {
  const fixtures = [
    { date: '2026-02-15', expected: '2026/02/W07/02.15' },
    { date: '2022-04-02', expected: '2022/03/W13/04.02' }, // Thu Mar 31 → March
    { date: '2019-06-15', expected: '2019/06/W24/06.15' },
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: dayDir(date),
      expected,
    })
  }
})

test('dayDir - no x prefix for cross-month days', () => {
  // 2022-04-02 was "x02" in v1, now it's just "04.02" under March's W13
  assert({
    given: '2022-04-02 (cross-month in v1)',
    should: 'use MM.DD format without prefix',
    actual: dayDir('2022-04-02'),
    expected: '2022/03/W13/04.02',
  })
})

test('dayDir - no _pre-2020 prefix', () => {
  assert({
    given: '2019-06-15 (pre-2020)',
    should: 'have no _pre-2020 prefix',
    actual: dayDir('2019-06-15'),
    expected: '2019/06/W24/06.15',
  })
})

test('dayDir - boundary weeks', () => {
  const fixtures = [
    { date: '2027-01-01', expected: '2027/01/W00/01.01' },
    { date: '2025-12-29', expected: '2025/12/W53/12.29' },
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: dayDir(date),
      expected,
    })
  }
})

test('dayDir - cross-month week keeps days together', () => {
  // W05-2026: Mon Jan 26 - Sun Feb 1, Thu = Jan 29 → January
  const fixtures = [
    { date: '2026-01-26', expected: '2026/01/W05/01.26' },
    { date: '2026-02-01', expected: '2026/01/W05/02.01' }, // Feb 1 under January
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: dayDir(date),
      expected,
    })
  }
})
