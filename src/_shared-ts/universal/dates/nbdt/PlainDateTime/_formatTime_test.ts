import { assert, test } from '#test'
import formatTime from './_formatTime.ts'

const FIXTURES = [
  {
    input: '13:45',
    expected: '13:45',
  },
  {
    input: 'does not have :',
    expected: '00:00',
  },
  {
    input: '27:3',
    expected: '27:03',
  },
  {
    input: '8:45',
    expected: '08:45',
  },
  {
    input: '8:5',
    expected: '08:05',
  },
]

FIXTURES.forEach(({ input, expected }) => {
  test(formatTime.name + ` ${input}`, () => {
    const actual = formatTime(input)

    assert({
      given: `an input string: ${input}`,
      should: `return a formatted time from string: ${expected}`,
      actual,
      expected: expected,
    })
  })
})
