import { assert, test } from '#test'
import PlainDateTime from './mod.ts'

const FIXTURES = [
  {
    input: [new Date(2024, 1, 10)],
    expected: `2024-02-10 00:00`,
  },
  {
    input: [new Date(2024, 1, 10, 13, 45)],
    expected: `2024-02-10 13:45`,
  },
]

test(PlainDateTime.name, () => {
  FIXTURES.forEach(({ input, expected }) => {
    const dt = new PlainDateTime(input[0])
    const actual = dt.toString()

    assert({
      given: `a valid input: ${input}`,
      should: `return a valid string representing a PlainDateTime: ${expected}`,
      actual,
      expected: expected,
    })
  })
})
