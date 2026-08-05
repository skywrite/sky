import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import dayFile from './dayFile.ts'
import fetchNow from './fetchNow.ts'

// Helper to create a temp directory with day files
function createTestDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchNow-test-'))
  return tmpDir
}

// Helper to create a day file in the test directory
function createDayFile(timeDir: string, date: Date, options: { started?: string; tz?: string } = {}): void {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const ymd = `${year}-${month}-${day}`

  const dayPath = path.join(timeDir, dayFile(ymd))
  const dir = path.dirname(dayPath)
  fs.mkdirSync(dir, { recursive: true })

  const dayShort = date.toLocaleDateString('en-us', { weekday: 'short' })

  let yaml = '---\n'
  if (options.started) yaml += `started: "${options.started}"\n`
  if (options.tz) yaml += `tz: ${options.tz}\n`
  yaml += '---\n'

  const markdown = `${yaml}\n# **${ymd} - ${dayShort}**\n`
  fs.writeFileSync(dayPath, markdown)
}

// Helper to clean up test directory
function cleanupTestDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

test('fetchNow - returns current day when day is started', async () => {
  const testDir = createTestDir()

  try {
    const today = new Date()
    createDayFile(testDir, today, { started: '08:00', tz: 'America/Chicago' })

    const mockNow = new ZonedDateTime(today, 'America/Chicago')
    const result = await fetchNow({ timeDir: testDir, now: mockNow })

    assert({
      given: 'a started day file for today',
      should: 'return a ZonedDateTime with the day timezone',
      actual: result.timezone,
      expected: 'America/Chicago',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('fetchNow - finds previous started day when today not started', async () => {
  const testDir = createTestDir()

  try {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    // Only create yesterday's file with started
    createDayFile(testDir, yesterday, { started: '09:00', tz: 'America/New_York' })

    const mockNow = new ZonedDateTime(today, 'America/Chicago')
    const result = await fetchNow({ timeDir: testDir, now: mockNow })

    assert({
      given: 'no started day today but yesterday is started',
      should: 'return timezone from yesterday',
      actual: result.timezone,
      expected: 'America/New_York',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('fetchNow - throws when no day files exist', async () => {
  const testDir = createTestDir()

  try {
    // Empty directory - no day files at all
    const today = new Date()
    const mockNow = new ZonedDateTime(today, 'America/Chicago')

    let threw = false
    try {
      await fetchNow({ timeDir: testDir, now: mockNow })
    } catch {
      threw = true
    }

    assert({
      given: 'empty directory with no day files',
      should: 'throw an error',
      actual: threw,
      expected: true,
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('fetchNow - uses default timezone when tz not specified', async () => {
  const testDir = createTestDir()

  try {
    const today = new Date()
    createDayFile(testDir, today, { started: '08:00' }) // no tz specified

    const mockNow = new ZonedDateTime(today, 'America/Los_Angeles')
    const result = await fetchNow({ timeDir: testDir, now: mockNow })

    assert({
      given: 'a day file without tz field',
      should: 'default to America/Chicago',
      actual: result.timezone,
      expected: 'America/Chicago',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('fetchNow - calculates extended hours when past midnight', async () => {
  const testDir = createTestDir()

  try {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    createDayFile(testDir, yesterday, { started: '08:00', tz: 'America/Chicago' })

    // Mock "now" as 2 AM the next day (which is 26:00 in extended hours)
    const todayAt2am = new Date(yesterday)
    todayAt2am.setDate(todayAt2am.getDate() + 1)
    todayAt2am.setHours(2, 0, 0, 0)

    const mockNow = new ZonedDateTime(todayAt2am, 'America/Chicago')
    const result = await fetchNow({ timeDir: testDir, now: mockNow })

    // The hours should be > 24 since we're past midnight from the started day
    const hours = parseInt(result.time.split(':')[0])

    assert({
      given: 'current time is past midnight from started day',
      should: 'return extended hours (> 24)',
      actual: hours >= 24,
      expected: true,
    })
  } finally {
    cleanupTestDir(testDir)
  }
})
