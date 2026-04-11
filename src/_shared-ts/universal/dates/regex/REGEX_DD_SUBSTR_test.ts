import { assert, test } from '#test'
import { REGEX_DD_SUBSTR } from './mod.ts'

const FIXTURES = {
  '05': { day: '05' },
  '2022-03-07/': { day: '07' },
  '2022-03-32': { day: '03' }, // careful, 32 is not a valid day, so it matches just the valid regex
  '34': undefined,
  '# **2022-03-07 - Mon **\n': { day: '07' },
}

test('REGEX_YMD_SUBSTR', () => {
  for (const [inputStr, expected] of Object.entries(FIXTURES)) {
    const groups = inputStr.match(REGEX_DD_SUBSTR)?.groups
    assert({
      actual: groups ? { ...groups } : undefined,
      expected,
    })
  }
})
