import { assert, test } from '#test'
import PlainDateTime from './mod.ts'

const FIXTURES = [
  {
    input: ['2024-09-16 13:45', 2],
    expected: '2024-09-16 15:45',
  },
  {
    input: ['2024-09-16 13:45', 2.5],
    expected: '2024-09-16 16:15',
  },
  {
    input: ['2024-09-16 23:45', 4],
    expected: '2024-09-16 27:45',
  },
]

FIXTURES.forEach(({ input, expected }) => {
  test('PlainDateTime.addHours' + ` ${input}`, () => {
    const dtString = input[0] as string
    const offsetHours = input[1] as number
    const dt = PlainDateTime.fromString(dtString)

    assert({
      given: `a valid input string: ${input[0]} and offset ${input[1]}`,
      should: `return a valid Date representing date from string: ${expected}`,
      actual: dt.addHours(offsetHours).toString(),
      expected,
    })
  })
})
