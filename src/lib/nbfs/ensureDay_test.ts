import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayFile, readDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { ensureDay } from './ensureDay.ts'

test('ensureDay creates one unstarted canonical day even with concurrent requests', async () => {
  const timeDir = await makeTempDir({ prefix: 'ensure-day-test-' })
  const day = new PlainDate('2025-12-31')
  try {
    const created = await Promise.all([ensureDay(day, timeDir), ensureDay(day, timeDir)])
    const doc = await readDay(day, timeDir)
    assert({
      given: 'two requests for the same missing day at a year boundary',
      should: 'publish just its complete template without starting it or creating other days',
      actual: {
        created: created.filter(Boolean).length,
        files: (await readdir(timeDir, { recursive: true })).filter((file) => file.endsWith('.md')),
        day: doc.day.ymd,
        started: doc.started,
        lists: doc.lists.map((list) => list.title),
      },
      expected: {
        created: 1,
        files: [dayFile(day)],
        day: '2025-12-31',
        started: undefined,
        lists: [
          'Professional Commitments',
          'Personal Commitments',
          'Professional Todos',
          'Personal Todos',
          'Reminders',
          'Professional Complete',
          'Personal Complete',
        ],
      },
    })

    const file = path.join(timeDir, dayFile(day))
    const planned = '# A hand-edited plan\n\n- Review Atlas\n  Keep this note.\n'
    await writeFile(file, planned)
    assert({
      given: 'an existing day whose format and contents were edited by hand',
      should: 'leave every byte intact on repeated creation',
      actual: [await ensureDay(day, timeDir), await readFile(file, 'utf8')],
      expected: [false, planned],
    })
  } finally {
    await rm(timeDir, { recursive: true, force: true })
  }
})
