import { assert, test } from '#test'
import createFromYMDHM from './createFromYMDHM.ts'

const FIXTURES: [string, Date][] = [
  ['2022-09-05 15:45', new Date(2022, 8, 5, 15, 45, 0, 0)],
  // Sept 6, 1:45 AM
  ['2022-09-05 25:45', new Date(2022, 8, 5, 25, 45, 0, 0)],
  // Sept 6, 1:45 AM
  ['2022-09-05 25:45', new Date(2022, 8, 6, 1, 45, 0, 0)],
]

test(createFromYMDHM.name, () => {
  const given = 'a valid YMD string'
  const should = 'return a valid date'

  for (const [input, expected] of FIXTURES) {
    const actual = createFromYMDHM(input)
    assert({ given, should, expected, actual })
  }
})
