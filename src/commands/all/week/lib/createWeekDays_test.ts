import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { createWeekDays } from './createWeekDays.ts'

test('creating a partial week keeps an existing future plan and fills only missing canonical days', async () => {
  const root = await makeTempDir({ prefix: 'week-days-test-' })
  const week = Week.of(new PlainDate('2025-12-31'))
  const plannedDay = week.days[2]
  const plannedFile = path.join(root, dayFile(plannedDay))
  const planned = '---\ncreated: 2025-12-31\n---\n\n## Professional Todos\n\n- Review Atlas\n  Keep this note.\n'
  try {
    await mkdir(path.dirname(plannedFile), { recursive: true })
    await writeFile(plannedFile, planned)
    const render = (day: PlainDate) => DayDocument.createFutureDay(day).toMarkdown()
    const results = await Promise.all([createWeekDays(week, root, render), createWeekDays(week, root, render)])
    assert({
      given: 'a partial week at a year boundary and two concurrent creation requests',
      should: 'create each missing canonical day once and preserve the scheduled plan',
      actual: {
        created: results.reduce((sum, result) => sum + result.created.length, 0),
        preserved: await readFile(plannedFile, 'utf8'),
        files: await Promise.all(week.days.map((day) => readdir(path.dirname(path.join(root, dayFile(day)))))),
      },
      expected: { created: week.days.length - 1, preserved: planned, files: week.days.map(() => ['day.md']) },
    })
    assert({
      given: 'a repeated week creation',
      should: 'leave every day intact',
      actual: (await createWeekDays(week, root, render)).created,
      expected: [],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
