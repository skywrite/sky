import { assert, test } from '#test'
import PlainDateTime from './mod.ts'

const FIXTURES = [
  {
    input: ['12:00', '2024-02-10'],
    expected: `2024-02-10 12:00`,
  },
  {
    input: ['9:00', '2024-02-10'],
    expected: `2024-02-10 09:00`,
  },
]

test(PlainDateTime.name, () => {
  FIXTURES.forEach(({ input, expected }) => {
    const dt = new PlainDateTime(input[0], input[1])
    const actual = dt.toString()

    assert({
      given: `a valid input: ${input}`,
      should: `return a valid string representing a PlainDateTime: ${expected}`,
      actual,
      expected: expected,
    })
  })
})
