import { assert, test } from '#test'
// import { REGEX_HHMM25_SUBSTR as REGEX } from './mod.ts'

const FIXTURES = {
  '23:59': { hour: '23', minute: '59' },
  '00:00': { hour: '00', minute: '00' },
  '13:45': { hour: '13', minute: '45' },
  '13:61': undefined,
  '24:00': { hour: '24', minute: '00' },
  ' 23:59': { hour: '23', minute: '59' },
  '0:00': { hour: '0', minute: '00' },
  '9:01': { hour: '9', minute: '01' },
  '99:33': { hour: '99', minute: '33' },
}

/*
test('REGEX_HHMM25_SUBSTR', () => {
  for (const [inputStr, expected] of Object.entries(FIXTURES)) {
    assert({
      given: 'an input str to match against HH:MM',
      should: 'return matching group or falsy',
      actual: inputStr.match(REGEX)?.groups,
      expected
    })
  }
})
*/
