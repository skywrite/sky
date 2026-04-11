import { assert, test } from '#test'
import isFirstDayOfTheYear from './isFirstDayOfTheYear.ts'

const FIXTURES: [Date, boolean][] = [
  [new Date('2024-01-01T00:00:00-06:00'), true],
  [new Date('2025-01-01T00:00:00-06:00'), true],
  [new Date('2025-03-01T12:37:00-06:00'), false],
]

test({ name: isFirstDayOfTheYear.name, ignore: true }, () => {
  for (const fixture of FIXTURES) {
    const [input, expected] = fixture
    const given = `The date ${String(input)}`
    const should = `Return ${expected}`

    assert({
      given,
      should,
      actual: isFirstDayOfTheYear(input),
      expected,
    })
  }
})
