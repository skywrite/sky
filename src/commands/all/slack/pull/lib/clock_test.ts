import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { createClock } from './clock.ts'

function createDayFile(timeDir: string, ymd: string, started: string): void {
  const dayPath = path.join(timeDir, dayFile(ymd))
  fs.mkdirSync(path.dirname(dayPath), { recursive: true })
  fs.writeFileSync(dayPath, `---\nstarted: "${started}"\ntz: America/Chicago\n---\n\n# **${ymd}**\n`)
}

test('createClock stamps a message with the notebook, system and UTC clocks', async () => {
  const timeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-slack-clock-'))
  try {
    createDayFile(timeDir, '2030-09-26', '08:00')
    createDayFile(timeDir, '2030-09-27', '08:00')
    const clock = createClock({ timezone: 'America/Chicago', timeDir })
    assert({
      given: 'half past midnight while the 26th is still open',
      should: 'file under the 26th past 24:00, beside the system and UTC clocks',
      actual: await clock('1916717400.000100'),
      expected: {
        notebook: '2030-09-26 24:30',
        system: '2030-09-27 00:30',
        zone: 'America/Chicago',
        utc: '2030-09-27 05:30',
      },
    })
    assert({
      given: 'seven in the morning, before the 27th started',
      should: 'still be the 26th',
      actual: (await clock('1916740800.000100')).notebook,
      expected: '2030-09-26 31:00',
    })
    assert({
      given: 'nine in the morning, after the 27th started at eight',
      should: 'be the 27th',
      actual: (await clock('1916748000.000100')).notebook,
      expected: '2030-09-27 09:00',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test('createClock with no started day in reach stamps the calendar day', async () => {
  const timeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-slack-clock-'))
  try {
    const clock = createClock({ timezone: 'America/Chicago', timeDir })
    assert({
      given: 'a notebook with no day files',
      should: 'use the system calendar day',
      actual: (await clock('1916717400.000100')).notebook,
      expected: '2030-09-27 00:30',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})
