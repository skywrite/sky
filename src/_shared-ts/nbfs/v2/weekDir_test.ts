import { assert, test } from '#test'
import weekDir from './weekDir.ts'

test('weekDir - normal dates', () => {
  const fixtures = [
    { date: '2026-02-15', expected: '2026/02/W07' },
    { date: '2022-04-02', expected: '2022/03/W13' }, // Thu Mar 31 → March
    { date: '2019-06-15', expected: '2019/06/W24' },
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: weekDir(date),
      expected,
    })
  }
})

test('weekDir - cross-month weeks use month of Thursday', () => {
  const fixtures = [
    // W05-2026: Mon Jan 26 - Sun Feb 1, Thu = Jan 29 → January
    { date: '2026-01-26', expected: '2026/01/W05' },
    { date: '2026-02-01', expected: '2026/01/W05' },

    // W40-2026: Mon Sep 28 - Sun Oct 4, Thu = Oct 1 → October
    { date: '2026-09-28', expected: '2026/10/W40' },
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: weekDir(date),
      expected,
    })
  }
})

test('weekDir - W00 and W53 boundaries', () => {
  const fixtures = [
    { date: '2027-01-01', expected: '2027/01/W00' }, // W00 → January
    { date: '2025-12-29', expected: '2025/12/W53' }, // W53 → December
    { date: '2026-12-28', expected: '2026/12/W53' }, // genuine ISO W53 → December
    { date: '2024-01-01', expected: '2024/01/W01' }, // clean Monday start
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: weekDir(date),
      expected,
    })
  }
})
