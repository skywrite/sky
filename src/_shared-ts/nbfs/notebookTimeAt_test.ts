import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import dayFile from './dayFile.ts'
import notebookTimeAt from './notebookTimeAt.ts'

const system = { systemTimezone: 'America/Chicago' }

function createTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'notebookTimeAt-test-'))
}

function createDayFile(timeDir: string, ymd: string, options: { started?: string; tz?: string } = {}): void {
  const dayPath = path.join(timeDir, dayFile(ymd))
  fs.mkdirSync(path.dirname(dayPath), { recursive: true })

  let yaml = '---\n'
  if (options.started) yaml += `started: "${options.started}"\n`
  yaml += `tz: ${options.tz ?? 'America/Chicago'}\n`
  yaml += '---\n'

  fs.writeFileSync(dayPath, `${yaml}\n# **${ymd}**\n`)
}

test('notebookTimeAt - half past midnight files under the day still open', async () => {
  const timeDir = createTestDir()

  try {
    createDayFile(timeDir, '2030-09-26', { started: '08:00' })

    assert({
      given: 'a message at 00:30 while the previous day is still open',
      should: 'name that day, in extended hours',
      actual: (await notebookTimeAt('2030-09-27 00:30', { timeDir, ...system })).toString(),
      expected: '2030-09-26 24:30',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test('notebookTimeAt - a day file nobody started does not take over', async () => {
  const timeDir = createTestDir()

  try {
    createDayFile(timeDir, '2030-09-26', { started: '08:00' })
    createDayFile(timeDir, '2030-09-27')

    assert({
      given: 'a next-day file an import prepared, never started',
      should: 'keep the moment on the day still open',
      actual: (await notebookTimeAt('2030-09-27 00:30', { timeDir, ...system })).toString(),
      expected: '2030-09-26 24:30',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test("notebookTimeAt - the next day's start is the boundary", async () => {
  const timeDir = createTestDir()

  try {
    createDayFile(timeDir, '2030-09-26', { started: '08:00' })
    createDayFile(timeDir, '2030-09-27', { started: '07:05' })

    assert({
      given: 'a moment before the next day was started',
      should: 'stay with the day that was open then',
      actual: (await notebookTimeAt('2030-09-27 06:00', { timeDir, ...system })).toString(),
      expected: '2030-09-26 30:00',
    })

    assert({
      given: 'a moment after the next day was started',
      should: 'land on that day at its own wall clock',
      actual: (await notebookTimeAt('2030-09-27 09:15', { timeDir, ...system })).toString(),
      expected: '2030-09-27 09:15',
    })

    assert({
      given: 'a daytime moment',
      should: 'keep its wall clock',
      actual: (await notebookTimeAt('2030-09-26 14:30', { timeDir, ...system })).toString(),
      expected: '2030-09-26 14:30',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test("notebookTimeAt - reads the time in the open day's zone", async () => {
  const timeDir = createTestDir()

  try {
    createDayFile(timeDir, '2030-09-26', { started: '08:00', tz: 'Europe/Budapest' })

    // 18:00 CDT is 01:00 CEST the next calendar day
    assert({
      given: 'a day kept in a zone seven hours ahead of the system',
      should: 'express the moment in that zone on the open day',
      actual: (await notebookTimeAt('2030-09-26 18:00', { timeDir, ...system })).toString(),
      expected: '2030-09-26 25:00',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test('notebookTimeAt - with no day started in the week before, the calendar day', async () => {
  const timeDir = createTestDir()

  try {
    createDayFile(timeDir, '2030-09-10', { started: '08:00' })
    createDayFile(timeDir, '2030-09-27')

    assert({
      given: 'a moment more than a week after the last started day',
      should: 'fall back to its own calendar day',
      actual: (await notebookTimeAt('2030-09-27 00:30', { timeDir, ...system })).toString(),
      expected: '2030-09-27 00:30',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})
