import { assert, test } from '#test'
import { REGEX_HHMM_EXACT as REGEX } from './mod.ts'

const FIXTURES = {
  '23:59': { hour: '23', minute: '59' },
  '00:00': { hour: '00', minute: '00' },
  '13:45': { hour: '13', minute: '45' },
  '13:61': undefined,
  '24:00': undefined,
  ' 23:59': undefined,
  '0:00': { hour: '0', minute: '00' },
  '9:01': { hour: '9', minute: '01' },
}

test('REGEX_HHMM_EXACT', () => {
  for (const [inputStr, expected] of Object.entries(FIXTURES)) {
    const groups = inputStr.match(REGEX)?.groups
    assert({
      given: 'an input str to match against HH:MM',
      should: 'return matching group or falsy',
      actual: groups ? { ...groups } : undefined,
      expected,
    })
  }
})
