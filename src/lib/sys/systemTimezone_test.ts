import { assert, test } from '#test'
import { isValidTimezoneIANA } from '#universal/dates/timezones/mod.ts'
import { readSystemTimezone, timezoneFromZoneinfoPath } from './systemTimezone.ts'

const parseFixtures = [
  {
    target: '/var/db/timezone/zoneinfo/America/Chicago',
    expected: 'America/Chicago',
    description: 'macOS symlink target',
  },
  {
    target: '/private/var/db/timezone/tz/2026b.1.0/zoneinfo/America/Chicago',
    expected: 'America/Chicago',
    description: 'fully resolved macOS tz bundle path',
  },
  {
    target: '../usr/share/zoneinfo/Europe/London',
    expected: 'Europe/London',
    description: 'relative Linux symlink target',
  },
  {
    target: '/usr/share/zoneinfo/UTC',
    expected: 'UTC',
    description: 'UTC zoneinfo path',
  },
  {
    target: '/var/db/timezone/zoneinfo/Bogus/Zone',
    expected: null,
    description: 'zoneinfo path with an invalid zone name',
  },
  {
    target: '/etc/somethingelse',
    expected: null,
    description: 'target outside a zoneinfo database',
  },
]

parseFixtures.forEach((fixture) => {
  test(`timezoneFromZoneinfoPath - ${fixture.description}`, () => {
    assert({
      given: `target "${fixture.target}"`,
      should: `return ${JSON.stringify(fixture.expected)}`,
      actual: timezoneFromZoneinfoPath(fixture.target),
      expected: fixture.expected,
    })
  })
})

test('readSystemTimezone - nonexistent path returns null', async () => {
  assert({
    given: 'a path that does not exist',
    should: 'return null instead of throwing',
    actual: await readSystemTimezone('/nonexistent/localtime'),
    expected: null,
  })
})

test('readSystemTimezone - default path returns null or a valid zone', async () => {
  const zone = await readSystemTimezone()
  assert({
    given: 'the default /etc/localtime path',
    should: 'return null or a runtime-accepted IANA zone',
    actual: zone === null || isValidTimezoneIANA(zone),
    expected: true,
  })
})
