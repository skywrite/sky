import { assert, test } from '#test'
import expandToYMD from './expandToYMD.ts'

const REF_DATE = new Date(2022, 9, 1)
const FIXTURES = [
  { input: '15', refDate: REF_DATE, expected: '2022-10-15' },
  { input: '10-15', refDate: REF_DATE, expected: '2022-10-15' },
  { input: '2022-10-15', refDate: REF_DATE, expected: '2022-10-15' },
  { input: '10-31', refDate: new Date(2022, 10, 2, 6, 10), expected: '2022-10-31' },
  { input: '2-10', refDate: new Date(2023, 3, 29, 10, 25), expected: '2023-02-10' },
]

test(expandToYMD.name, () => {
  const given = 'a valid YMD string or integers'
  const should = 'return a valid YMD string'

  FIXTURES.forEach(({ input, refDate, expected }) => {
    assert({
      given,
      should,
      actual: expandToYMD(input, refDate),
      expected,
    })
  })
})

test(expandToYMD.name, () => {
  const given = 'a invalid YMD string or integers'
  const should = 'throw'

  let thrown = false
  try {
    expandToYMD('', REF_DATE)
  } catch {
    thrown = true
  }

  assert({
    given,
    should,
    expected: true,
    actual: thrown,
  })
})
