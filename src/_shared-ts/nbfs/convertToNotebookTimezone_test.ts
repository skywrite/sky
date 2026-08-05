import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import convertToNotebookTimezone from './convertToNotebookTimezone.ts'
import dayFile from './dayFile.ts'
import fetchNow from './fetchNow.ts'

// Helper to create a temp directory with day files
function createTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'convertToNotebookTimezone-test-'))
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

// Helper to clean up test directory
function cleanupTestDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

// Helper to capture console.warn output during a test
function captureWarnings(): { warnings: string[]; restore: () => void } {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  return { warnings, restore: () => (console.warn = original) }
}

function createTodayDayFile(timeDir: string, options: { started?: string; tz?: string } = {}): void {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  createDayFile(timeDir, `${now.getFullYear()}-${month}-${day}`, options)
}

test('convertToNotebookTimezone - same timezone returns wall clock unchanged', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, '2026-06-15', { tz: 'America/Chicago' })

    const result = await convertToNotebookTimezone('2026-06-15 14:30', {
      timeDir: testDir,
      systemTimezone: 'America/Chicago',
    })

    assert({
      given: 'a day whose timezone matches the system timezone',
      should: 'return the same wall-clock time',
      actual: result.toString(),
      expected: '2026-06-15 14:30',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - converts to the day timezone', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, '2026-06-15', { tz: 'Europe/Budapest' })

    // CDT (UTC-5) → CEST (UTC+2) = +7 hours
    const result = await convertToNotebookTimezone('2026-06-15 02:00', {
      timeDir: testDir,
      systemTimezone: 'America/Chicago',
    })

    assert({
      given: 'a 02:00 Chicago wall clock on a Budapest day',
      should: 'convert to 09:00 Budapest time',
      actual: result.toString(),
      expected: '2026-06-15 09:00',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - keeps extended hours when crossing midnight', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, '2026-06-15', { tz: 'Europe/Budapest' })

    // 18:00 CDT = 01:00 CEST next calendar day = 25:00 in extended hours
    const result = await convertToNotebookTimezone('2026-06-15 18:00', {
      timeDir: testDir,
      systemTimezone: 'America/Chicago',
    })

    assert({
      given: 'a conversion that crosses midnight in the day timezone',
      should: 'keep the extended-hours form on the same logical day',
      actual: result.toString(),
      expected: '2026-06-15 25:00',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - accepts a Date instant', async () => {
  const testDir = createTestDir()

  try {
    createDayFile(testDir, '2026-06-15', { tz: 'Europe/Budapest' })

    // Local constructor + local rendering are symmetric, so this reads as
    // "2026-06-15 02:00" system wall clock regardless of the process timezone
    const instant = new Date(2026, 5, 15, 2, 0)
    const result = await convertToNotebookTimezone(instant, {
      timeDir: testDir,
      systemTimezone: 'America/Chicago',
    })

    assert({
      given: 'a Date instant rendering as 02:00 in the system timezone',
      should: 'convert to the day timezone like a wall-clock string',
      actual: result.toString(),
      expected: '2026-06-15 09:00',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - falls back to the current notebook timezone when day file is missing', async () => {
  const testDir = createTestDir()

  try {
    createTodayDayFile(testDir, { started: '08:00', tz: 'America/New_York' })

    // CST (UTC-6) → EST (UTC-5) = +1 hour
    const result = await convertToNotebookTimezone('2024-01-10 12:00', {
      timeDir: testDir,
      systemTimezone: 'America/Chicago',
    })

    assert({
      given: 'no day file for the timestamp but a started current day',
      should: 'convert using the current notebook timezone',
      actual: result.toString(),
      expected: '2024-01-10 13:00',
    })
  } finally {
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - warns and falls back to notebook now for an invalid Date', async () => {
  const testDir = createTestDir()
  const captured = captureWarnings()

  try {
    createTodayDayFile(testDir, { started: '08:00', tz: 'America/Chicago' })

    const result = await convertToNotebookTimezone(new Date('nonsense'), { timeDir: testDir })

    assert({
      given: 'an invalid Date',
      should: 'warn about it',
      actual: captured.warnings.some((w) => w.includes('invalid Date')),
      expected: true,
    })

    assert({
      given: 'an invalid Date',
      should: 'fall back to the current notebook day',
      actual: result.date,
      expected: (await fetchNow({ timeDir: testDir })).plainDateTime.date,
    })
  } finally {
    captured.restore()
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - warns and falls back for non-string non-Date input', async () => {
  const testDir = createTestDir()
  const captured = captureWarnings()

  try {
    createTodayDayFile(testDir, { started: '08:00', tz: 'America/Chicago' })

    await convertToNotebookTimezone(NaN as unknown as string, { timeDir: testDir })

    assert({
      given: 'NaN passed through a type hole',
      should: 'warn about unsupported input instead of throwing',
      actual: captured.warnings.some((w) => w.includes('unsupported input of type number')),
      expected: true,
    })
  } finally {
    captured.restore()
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - warns and falls back for empty and unparseable strings', async () => {
  const testDir = createTestDir()
  const captured = captureWarnings()

  try {
    createTodayDayFile(testDir, { started: '08:00', tz: 'America/Chicago' })

    await convertToNotebookTimezone('  ', { timeDir: testDir })
    await convertToNotebookTimezone('not a timestamp', { timeDir: testDir })

    assert({
      given: 'an empty string',
      should: 'warn about it',
      actual: captured.warnings.some((w) => w.includes('empty string')),
      expected: true,
    })

    assert({
      given: 'an unparseable string',
      should: 'warn with the offending value',
      actual: captured.warnings.some((w) => w.includes('could not parse "not a timestamp"')),
      expected: true,
    })
  } finally {
    captured.restore()
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - accepts ISO strings with a zone designator as instants', async () => {
  const testDir = createTestDir()
  const captured = captureWarnings()

  try {
    createDayFile(testDir, '2026-06-14', { tz: 'Europe/Budapest' })
    createDayFile(testDir, '2026-06-15', { tz: 'Europe/Budapest' })

    const iso = '2026-06-15T07:00:00.000Z'
    const viaString = await convertToNotebookTimezone(iso, { timeDir: testDir })
    const viaDate = await convertToNotebookTimezone(new Date(iso), { timeDir: testDir })

    assert({
      given: 'an ISO string the notebook parser rejects',
      should: 'parse it like the equivalent Date instant',
      actual: viaString.toString(),
      expected: viaDate.toString(),
    })

    assert({
      given: 'a successfully second-chance-parsed string',
      should: 'not warn',
      actual: captured.warnings,
      expected: [],
    })
  } finally {
    captured.restore()
    cleanupTestDir(testDir)
  }
})

test('convertToNotebookTimezone - warns and keeps the system wall clock when the day timezone is invalid', async () => {
  const testDir = createTestDir()
  const captured = captureWarnings()

  try {
    createDayFile(testDir, '2026-06-15', { tz: 'Not/AZone' })

    const result = await convertToNotebookTimezone('2026-06-15 14:30', {
      timeDir: testDir,
      systemTimezone: 'America/Chicago',
    })

    assert({
      given: 'a day file with an invalid tz value',
      should: 'warn about the failed conversion',
      actual: captured.warnings.some((w) => w.includes('failed')),
      expected: true,
    })

    assert({
      given: 'a day file with an invalid tz value',
      should: 'keep the system wall clock unconverted',
      actual: result.toString(),
      expected: '2026-06-15 14:30',
    })
  } finally {
    captured.restore()
    cleanupTestDir(testDir)
  }
})
