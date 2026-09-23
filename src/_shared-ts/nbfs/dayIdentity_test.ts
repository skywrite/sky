import { spyOn } from 'bun:test'
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import writeDayItems from '#lib/nbfs/writeDayItems.ts'
import { makeTempDir, outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayFile from './dayFile.ts'
import readDay from './readDay.ts'
import readDaySync from './readDaySync.ts'
import writeDay from './writeDay.ts'

const SOURCE = new PlainDate('2031-03-15')
const TODAY = new PlainDate('2031-03-16')

for (const heading of ['# **undefined - undefined**', '# Notes', '# **2031-03-16 - Sun**']) {
  test(`day reads reject a missing or mismatched identity: ${heading}`, async () => {
    const timeDir = await makeTempDir({ prefix: 'day-identity-test-' })
    const clock = spyOn(PlainDate, 'today').mockReturnValue(TODAY)
    const sourceFile = path.join(timeDir, dayFile(SOURCE))
    const todayFile = path.join(timeDir, dayFile(TODAY))
    const source = `---\nstarted: 08:10\n---\n\n${heading}\n\n## Professional Todos\n\n- Review Atlas\n`
    const today = DayDocument.createFutureDay(TODAY).addTodoItem('Prepare the Widget demo').toMarkdown()
    try {
      await outputFile(sourceFile, source)
      await outputFile(todayFile, today)

      let syncError: unknown
      try {
        readDaySync(SOURCE.ymd, timeDir)
      } catch (error) {
        syncError = error
      }

      let writeError: unknown
      try {
        await writeDayItems(SOURCE, 'Professional Complete', '10:00 > Review complete', { timeDir })
      } catch (error) {
        writeError = error
      }

      assert({
        given: 'a day whose heading does not identify the requested file date',
        should: 'reject both read paths before an edit can overwrite another day',
        actual: {
          syncRejected: syncError instanceof Error && /date|heading/i.test(syncError.message),
          writeRejected: writeError instanceof Error && /date|heading/i.test(writeError.message),
          sourceUnchanged: (await readTextFile(sourceFile)) === source,
          todayUnchanged: (await readTextFile(todayFile)) === today,
        },
        expected: { syncRejected: true, writeRejected: true, sourceUnchanged: true, todayUnchanged: true },
      })
    } finally {
      clock.mockRestore()
      await rm(timeDir, { recursive: true, force: true })
    }
  })
}

for (const markdown of ['', '---\nstarted: 08:10\n---\n\n# Notes\n']) {
  test(`writeDay refuses to infer a date for undated content: ${JSON.stringify(markdown)}`, async () => {
    const timeDir = await makeTempDir({ prefix: 'day-identity-test-' })
    const clock = spyOn(PlainDate, 'today').mockReturnValue(TODAY)
    const todayFile = path.join(timeDir, dayFile(TODAY))
    const today = DayDocument.createFutureDay(TODAY).addTodoItem('Prepare the Widget demo').toMarkdown()
    try {
      await outputFile(todayFile, today)
      const doc = DayDocument.fromMarkdown(markdown).addTodoItem('Review Atlas').updateYaml({ location: 'Test room' })
      let writeError: unknown
      try {
        await writeDay(doc, timeDir)
      } catch (error) {
        writeError = error
      }

      assert({
        given: 'undated content after list edits and a metadata update',
        should: 'fail to save instead of treating it as today',
        actual: {
          rejected: writeError instanceof Error && /date|heading/i.test(writeError.message),
          todayUnchanged: (await readTextFile(todayFile)) === today,
        },
        expected: { rejected: true, todayUnchanged: true },
      })
    } finally {
      clock.mockRestore()
      await rm(timeDir, { recursive: true, force: true })
    }
  })
}

test('a correctly dated historical day keeps its identity through edits and saves', async () => {
  const timeDir = await makeTempDir({ prefix: 'day-identity-test-' })
  const clock = spyOn(PlainDate, 'today').mockReturnValue(TODAY)
  try {
    await writeDay(DayDocument.createFutureDay(SOURCE).addTodoItem('Review Atlas'), timeDir)
    const todayFile = path.join(timeDir, dayFile(TODAY))
    const today = DayDocument.createFutureDay(TODAY).addTodoItem('Prepare the Widget demo').toMarkdown()
    await outputFile(todayFile, today)

    await writeDayItems(SOURCE.ymd, 'Professional Complete', '10:00 > Review complete', { timeDir })
    const updated = await readDay(SOURCE, timeDir)
    assert({
      given: 'a file with a heading that matches its requested date',
      should: 'save edits to that date while preserving today',
      actual: {
        date: updated.day.ymd,
        syncDate: readDaySync(SOURCE.ymd, timeDir).day.ymd,
        items: updated.lists.find((list) => list.title === 'Professional Complete')?.items,
        todayUnchanged: (await readTextFile(todayFile)) === today,
      },
      expected: {
        date: SOURCE.ymd,
        syncDate: SOURCE.ymd,
        items: ['10:00 > Review complete'],
        todayUnchanged: true,
      },
    })
  } finally {
    clock.mockRestore()
    await rm(timeDir, { recursive: true, force: true })
  }
})
