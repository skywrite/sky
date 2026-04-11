import { assert, test } from '#test'
import { REGEX_MMDD_SUBSTR } from './mod.ts'

const FIXTURES = {
  '2023-10-05': { month: '10', day: '05' },
  '2022-03-07': { month: '03', day: '07' },
  '2022-03-32': undefined, // not 32 days in a month
  '# **2022-03-07 - Mon **\n': { month: '03', day: '07' },
  '# **03-07 - Mon **\n': { month: '03', day: '07' },
  '03-07': { month: '03', day: '07' },
}

test('REGEX_MMDD_SUBSTR', () => {
  for (const [inputStr, expected] of Object.entries(FIXTURES)) {
    const groups = inputStr.match(REGEX_MMDD_SUBSTR)?.groups
    assert({
      actual: groups ? { ...groups } : undefined,
      expected,
    })
  }
})
