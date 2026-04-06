import { assert, test } from '#test'
import { REGEX_YMD_SUBSTR } from './mod.ts'

const FIXTURES = {
  '2023-10-05': { year: '2023', month: '10', day: '05' },
  '2022-03-07': { year: '2022', month: '03', day: '07' },
  '2022-03-32': undefined,
  '# **2022-03-07 - Mon **\n': { year: '2022', month: '03', day: '07' },
}

test('REGEX_YMD_SUBSTR', () => {
  for (const [inputStr, expected] of Object.entries(FIXTURES)) {
    const groups = inputStr.match(REGEX_YMD_SUBSTR)?.groups
    assert({
      actual: groups ? { ...groups } : undefined,
      expected,
    })
  }
})
