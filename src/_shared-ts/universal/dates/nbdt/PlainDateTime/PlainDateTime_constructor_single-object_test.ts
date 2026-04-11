import { assert, test } from '#test'
import PlainDateTime from './mod.ts'

const FIXTURES = [
  {
    input: { date: '2024-02-10', time: '12:00' },
    expected: `2024-02-10 12:00`,
  },
  {
    input: { date: '2024-02-10' },
    expected: `2024-02-10 00:00`,
  },
  {
    input: { date: '2024-02-10', time: '8:00' },
    expected: `2024-02-10 08:00`,
  },
]

test(PlainDateTime.name, () => {
  FIXTURES.forEach(({ input, expected }) => {
    const dt = new PlainDateTime(input)
    const actual = dt.toString()

    assert({
      given: `a valid input: ${input}`,
      should: `return a valid string representing a PlainDateTime: ${expected}`,
      actual,
      expected: expected,
    })
  })
})
