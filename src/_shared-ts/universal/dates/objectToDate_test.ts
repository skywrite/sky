import { assert, test } from '#test'
import objectToDate from './objectToDate.ts'

const FIXTURES = new Map([
  [{ year: '2023', month: '12', day: '23' }, new Date(2023, 11, 23)],
  [{ month: '12', day: '23' }, new Date(new Date().getFullYear(), 11, 23)],
  [{ day: '23' }, new Date(new Date().getFullYear(), new Date().getMonth(), 23)],
])

test(objectToDate.name, () => {
  for (const [input, expected] of FIXTURES.entries()) {
    assert({
      actual: objectToDate(input),
      expected,
    })
  }
})
