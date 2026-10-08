import { spyOn } from 'bun:test'
import { CommandResult } from '#commands/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from './_testNotebook.ts'
import DayEnd from './end.ts'

for (const { name, perfect, todo, expected } of [
  { name: 'completed plan', perfect: true, todo: '~~Review Atlas~~', expected: true },
  { name: 'declined perfect day', perfect: false, todo: '~~Review Atlas~~', expected: false },
  { name: 'unfinished plan', perfect: true, todo: 'Review Atlas', expected: false },
]) {
  test(`day:end records the perfect-day choice for a ${name}`, async () => {
    await withDayNotebook(async (notebook) => {
      const { context, tasks } = notebook
      const currentDay = context.notebookNow.plainDateTime.plainDate
      const day = currentDay.addDays(-1)
      const timeDir = context.config.DIR_TIME
      await writeDay(DayDocument.createFutureDay(currentDay).setTimezone('UTC'), timeDir)
      const prepared = DayDocument.createFutureDay(day)
        .setTimezone('UTC')
        .setStarted(new ZonedDateTime(`${day.ymd}T07:00:00`, 'UTC'))
        .addTodoItem(todo)
        .updateYaml({ perfect: true })
      await writeDay(prepared, timeDir)
      const run = spyOn(tasks, 'run').mockResolvedValue(CommandResult.success())
      try {
        const result = await new DayEnd().run({ ...notebook, args: { day, perfect } })
        const doc = await readDay(day, timeDir)
        assert({
          given: `a ${name} and a previously saved perfect marker`,
          should: 'end the day, save the chosen result and preserve its tasks',
          actual: {
            ok: result.ok,
            ended: Boolean(doc.ended),
            perfect: doc.yaml.perfect,
            todos: doc.lists.find((list) => list.title === 'Professional Todos')?.items,
          },
          expected: { ok: true, ended: true, perfect: expected, todos: [todo] },
        })
      } finally {
        run.mockRestore()
      }
    })
  })
}
