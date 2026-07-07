import { assert, test } from '#test'
import isValidTimezoneIANA from './isValidTimezoneIANA.ts'

const fixtures = [
  { timezone: 'America/Chicago', expected: true, description: 'canonical IANA zone' },
  { timezone: 'UTC', expected: true, description: 'UTC is accepted' },
  { timezone: 'Atlantic/Reykjavik', expected: true, description: 'linked IANA zone' },
  { timezone: 'Bogus/Zone', expected: false, description: 'nonexistent zone' },
  { timezone: '', expected: false, description: 'empty string' },
  { timezone: '/etc/localtime', expected: false, description: 'a path is not a zone name' },
]

fixtures.forEach((fixture) => {
  test(`isValidTimezoneIANA - ${fixture.description}`, () => {
    assert({
      given: `timezone "${fixture.timezone}"`,
      should: `return ${fixture.expected}`,
      actual: isValidTimezoneIANA(fixture.timezone),
      expected: fixture.expected,
    })
  })
})
