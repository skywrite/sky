import { assert, test } from '#test'
import { REGEX_YMD_EXACT } from './mod.ts'

const FIXTURES = {
  '2022-03-07': { year: '2022', month: '03', day: '07' },
  '2022-03-32': undefined,
  '2022-3-12': undefined,
  '2022-13-12': undefined,
  '# **2022-03-07 - Mon **\n': undefined,
}

test('REGEX_YMD_EXACT', () => {
  for (const [inputStr, expected] of Object.entries(FIXTURES)) {
    const groups = inputStr.match(REGEX_YMD_EXACT)?.groups
    assert({
      actual: groups ? { ...groups } : undefined,
      expected,
    })
  }
})
