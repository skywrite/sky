import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import convertFromNotebookTimezone from './convertFromNotebookTimezone.ts'
import convertToNotebookTimezone from './convertToNotebookTimezone.ts'
import dayFile from './dayFile.ts'

// A time dir whose listed days are all kept in `tz`.
function timeDirIn(tz: string, days: string[]): string {
  const timeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convertFromNotebookTimezone-test-'))
  for (const ymd of days) {
    const dayPath = path.join(timeDir, dayFile(ymd))
    fs.mkdirSync(path.dirname(dayPath), { recursive: true })
    fs.writeFileSync(dayPath, `---\ntz: ${tz}\n---\n\n# **${ymd}**\n`)
  }
  return timeDir
}

test('convertFromNotebookTimezone - reads a time in the zone of its own day', async () => {
  const timeDir = timeDirIn('Pacific/Honolulu', ['2026-06-15'])
  try {
    const instant = await convertFromNotebookTimezone(PlainDateTime.fromString('2026-06-15 14:34'), { timeDir })
    assert({
      given: '14:34 on a day kept in Honolulu (UTC-10)',
      should: 'name 00:34 UTC the next day, whatever zone the system is in',
      actual: instant.toString(),
      expected: '2026-06-16T00:34:00Z',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test('convertFromNotebookTimezone - extended hours run past midnight', async () => {
  const timeDir = timeDirIn('Asia/Tokyo', ['2026-06-15'])
  try {
    const instant = await convertFromNotebookTimezone(PlainDateTime.fromString('2026-06-15 25:30'), { timeDir })
    assert({
      given: '25:30 on a day kept in Tokyo (UTC+9)',
      should: 'name 01:30 the next morning in Tokyo',
      actual: instant.toString(),
      expected: '2026-06-15T16:30:00Z',
    })
  } finally {
    fs.rmSync(timeDir, { recursive: true, force: true })
  }
})

test('convertFromNotebookTimezone - undoes convertToNotebookTimezone', async () => {
  // System wall clocks in Chicago on either side of midnight, and the instants they name.
  const moments = [
    { wall: '2026-06-15 23:30', instant: '2026-06-16T04:30:00Z' },
    { wall: '2026-06-16 00:30', instant: '2026-06-16T05:30:00Z' },
  ]
  for (const tz of ['Pacific/Honolulu', 'Asia/Tokyo', 'America/Chicago']) {
    const timeDir = timeDirIn(tz, ['2026-06-15', '2026-06-16'])
    try {
      for (const { wall, instant } of moments) {
        const written = await convertToNotebookTimezone(wall, { timeDir, systemTimezone: 'America/Chicago' })
        const read = await convertFromNotebookTimezone(written, { timeDir })
        assert({
          given: `${wall} in Chicago, written as ${written} on a day kept in ${tz}`,
          should: 'read back as the same instant',
          actual: read.toString(),
          expected: instant,
        })
      }
    } finally {
      fs.rmSync(timeDir, { recursive: true, force: true })
    }
  }
})
