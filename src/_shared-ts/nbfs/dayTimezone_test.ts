import { assert, test } from '#test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import dayTimezone from './dayTimezone.ts'
import dayFile from './dayFile.ts'

// Helper to create a temp directory with day files
function createTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dayTimezone-test-'))
}

// Helper to create a day file in the test directory
function createDayFile(timeDir: string, ymd: string, options: { started?: string; tz?: string } = {}): void {
  const dayPath = path.join(timeDir, dayFile(ymd))
  fs.mkdirSync(path.dirname(dayPath), { recursive: true })

  let yaml = '---\n'
  if (options.started) yaml += `started: "${options.started}"\n`
  if (options.tz) yaml += `tz: ${options.tz}\n`
  yaml += '---\n'

  fs.writeFileSync(dayPath, `${yaml}\n# **${ymd}**\n`)
}

function todayYMD(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// Helper to clean up test directory
function cleanupTestDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

test('dayTimezone - reads tz from the day file', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, '2026-06-15', { tz: 'Asia/Hong_Kong' })

    assert({
      given: 'a day file with tz: Asia/Hong_Kong',
      should: 'return that timezone',
      actual: await dayTimezone('2026-06-15', testDir),
      expected: 'Asia/Hong_Kong',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('dayTimezone - falls back to current notebook timezone when day file is missing', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, todayYMD(), { started: '08:00', tz: 'America/Denver' })

    assert({
      given: 'no day file for the requested date but a started current day',
      should: 'return the current notebook timezone',
      actual: await dayTimezone('2020-01-01', testDir),
      expected: 'America/Denver',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('dayTimezone - uses the day model default when tz is not specified', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, '2026-06-15', { started: '08:00' }) // no tz field

    assert({
      given: 'a day file without a tz field',
      should: 'return the DayDocument default timezone',
      actual: await dayTimezone('2026-06-15', testDir),
      expected: 'America/Chicago',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})
