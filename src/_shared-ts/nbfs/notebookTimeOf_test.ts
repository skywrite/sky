import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayFile from './dayFile.ts'
import notebookTimeOf from './notebookTimeOf.ts'

async function startedDay(timeDir: string, ymd: string, started: string, tz: string) {
  const file = path.join(timeDir, dayFile(ymd))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `---\nstarted: "${started}"\ntz: ${tz}\n---\n\n# **${ymd} - ${new PlainDate(ymd).dayShort}**\n`)
}

test('a past moment reads on the clock of the day that was running then', async () => {
  const timeDir = await makeTempDir({ prefix: 'sky-notebook-time-' })
  const at = (iso: string) => notebookTimeOf(Instant.from(iso), 'America/Los_Angeles', timeDir).toString()
  try {
    await startedDay(timeDir, '2031-03-12', '07:00', 'Asia/Tokyo')
    await startedDay(timeDir, '2031-03-13', '08:00', 'Asia/Tokyo')
    assert({
      given: 'a moment during a day started in Tokyo, read where it is still the day before',
      should: 'write it on that day in Tokyo time',
      actual: at('2031-03-11T22:45:10Z'),
      expected: '2031-03-12 07:45',
    })
    assert({
      given: 'a moment after midnight, before the next day started',
      should: 'stay on the running day, past 24:00',
      actual: at('2031-03-12T16:10:00Z'),
      expected: '2031-03-12 25:10',
    })
    assert({
      given: 'a moment after the next day started',
      should: 'move to that day',
      actual: at('2031-03-13T00:30:00Z'),
      expected: '2031-03-13 09:30',
    })
  } finally {
    await rm(timeDir, { recursive: true, force: true })
  }
})

test('a past moment reads in the given time zone when no day was started', async () => {
  const timeDir = await makeTempDir({ prefix: 'sky-notebook-time-empty-' })
  try {
    assert({
      given: 'a notebook with no started day',
      should: 'write the moment in the time zone it was given',
      actual: notebookTimeOf(Instant.from('2031-03-11T22:45:10Z'), 'America/Los_Angeles', timeDir).toString(),
      expected: '2031-03-11 15:45',
    })
  } finally {
    await rm(timeDir, { recursive: true, force: true })
  }
})
