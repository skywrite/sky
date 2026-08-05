import { realpathSync } from 'node:fs'
import { mkdir, rm, symlink } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import delay from '#universal/async/delay.ts'
import { isValidTimezoneIANA } from '#universal/dates/timezones/mod.ts'
import { readSystemTimezone, timezoneFromZoneinfoPath } from './systemTimezone.ts'

// realpath so watcher/path comparisons see symlink-free paths (macOS /tmp and
// /var are symlinks into /private)
const TEST_DIR = path.join(realpathSync(os.tmpdir()), 'sky-system-timezone-test')

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
    actual: await readSystemTimezone('/nonexistent/localtime', { attempts: 1 }),
    expected: null,
  })
})

test('readSystemTimezone - returns null only after exhausting retries', async () => {
  const start = performance.now()
  const zone = await readSystemTimezone('/nonexistent/localtime', { attempts: 3, retryDelayMs: 20 })
  const elapsed = performance.now() - start

  assert({
    given: 'a path that never becomes readable',
    should: 'return null',
    actual: zone,
    expected: null,
  })
  assert({
    given: '3 attempts spaced 20ms apart',
    should: 'wait through both retry delays before giving up',
    actual: elapsed >= 40,
    expected: true,
  })
})

test('readSystemTimezone - reads an existing symlink without retries', async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(TEST_DIR, { recursive: true })
  const link = path.join(TEST_DIR, 'localtime')
  await symlink('/var/db/timezone/zoneinfo/America/Chicago', link)

  try {
    assert({
      given: 'a readable zoneinfo symlink',
      should: 'return its zone on the first attempt',
      actual: await readSystemTimezone(link, { attempts: 1 }),
      expected: 'America/Chicago',
    })
  } finally {
    await rm(TEST_DIR, { recursive: true, force: true })
  }
})

test('readSystemTimezone - retries through a transient relink window', async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(TEST_DIR, { recursive: true })
  const link = path.join(TEST_DIR, 'localtime')

  // Simulate the wake-window relink: the symlink is briefly absent and
  // appears while the reader is mid-retry.
  const relink = delay(60).then(() => symlink('/var/db/timezone/zoneinfo/Europe/London', link))

  try {
    const zone = await readSystemTimezone(link, { attempts: 10, retryDelayMs: 30 })
    await relink
    assert({
      given: 'a symlink that appears between attempts',
      should: 'return the zone once the read succeeds',
      actual: zone,
      expected: 'Europe/London',
    })
  } finally {
    await rm(TEST_DIR, { recursive: true, force: true })
  }
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
