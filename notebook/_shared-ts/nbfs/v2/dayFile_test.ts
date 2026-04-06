import { assert, test } from '#test'
import dayFile from './dayFile.ts'

test('dayFile - normal dates', () => {
  const fixtures = [
    { date: '2026-02-15', expected: '2026/02/W07/02.15/day.md' },
    { date: '2022-04-02', expected: '2022/03/W13/04.02/day.md' },
    { date: '2019-06-15', expected: '2019/06/W24/06.15/day.md' },
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: dayFile(date),
      expected,
    })
  }
})

test('dayFile - boundary weeks', () => {
  const fixtures = [
    { date: '2027-01-01', expected: '2027/01/W00/01.01/day.md' },
    { date: '2025-12-29', expected: '2025/12/W53/12.29/day.md' },
    { date: '2026-12-28', expected: '2026/12/W53/12.28/day.md' },
  ]

  for (const { date, expected } of fixtures) {
    assert({
      given: date,
      should: `return ${expected}`,
      actual: dayFile(date),
      expected,
    })
  }
})
