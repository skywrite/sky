import { spyOn } from 'bun:test'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from './_testNotebook.ts'
import CommitmentsIncomplete from './commitments/incomplete.ts'
import MoveCommitments from './commitments/move-future.ts'
import CopyReminders from './reminders/copy-future.ts'
import MoveReminders from './reminders/move-future.ts'
import TodosIncomplete from './todo/incomplete.ts'
import MoveTodos from './todo/move-future.ts'

const SOURCE = new PlainDate('2031-03-16')
const TARGET = SOURCE.addDays(1)
const cases = [
  { command: new MoveTodos(), list: 'Professional Todos', item: 'Review [Atlas][atlas]', copy: false },
  { command: new MoveCommitments(), list: 'Personal Commitments', item: '10:00 > Review [Atlas][atlas]', copy: false },
  { command: new MoveReminders(), list: 'Reminders', item: 'Review [Atlas][atlas]', copy: false },
  { command: new CopyReminders(), list: 'Reminders', item: 'Review [Atlas][atlas]', copy: true },
]

test('moving reminders to their current day preserves the file', async () => {
  await withDayNotebook(async (notebook) => {
    const timeDir = notebook.context.config.DIR_TIME
    await writeDay(DayDocument.createFutureDay(SOURCE).addReminderItem('Review Atlas'), timeDir)
    const file = path.join(timeDir, dayFile(SOURCE))
    const before = await readTextFile(file)
    const result = await new MoveReminders().run({ ...notebook, args: { old: SOURCE, new: SOURCE } })
    assert({
      given: 'the same source and destination date',
      should: 'leave reminders in place without duplicating or removing them',
      actual: [result.ok, await readTextFile(file)],
      expected: [true, before],
    })
  })
})

for (const { command, list, item, copy } of cases) {
  const name = command.constructor.name
  test(`${name} prepares only a needed destination and preserves its existing plan`, async () => {
    await withDayNotebook(async (notebook) => {
      const { context, tasks } = notebook
      const timeDir = context.config.DIR_TIME
      const source = DayDocument.createFutureDay(SOURCE)
        .addItem(list, '~~Already finished~~')
        .addItem(list, item, { links: new Map([['atlas', { label: 'atlas', href: 'https://example.com/atlas' }]]) })
      const sweep = spyOn(tasks, 'run').mockImplementation(async (name, args) => {
        const task = name === 'day:todo:incomplete' ? new TodosIncomplete() : new CommitmentsIncomplete()
        return task.run({
          ...notebook,
          args: { day: args?.day as PlainDate, category: String(args?.category), dryRun: false, cleanOnly: false },
        })
      })
      const invoke = () =>
        command.run({
          ...notebook,
          args: { old: SOURCE, new: TARGET, category: list, noIncomplete: false },
        })
      try {
        await writeDay(source, timeDir)
        await invoke()
        const destination = await readDay(TARGET, timeDir)
        assert({
          given: 'unfinished work moved or copied across the week boundary into a missing day',
          should: 'create just that unstarted day, retain links and handle the source according to the operation',
          actual: {
            files: (await readdir(timeDir, { recursive: true })).filter((file) => file.endsWith('.md')).sort(),
            started: destination.started,
            items: destination.lists.find((section) => section.title === list)?.items,
            link: destination.links.get('atlas')?.href,
            sourceHasItem: (await readDay(SOURCE, timeDir)).lists
              .find((section) => section.title === list)
              ?.items.includes(item),
          },
          expected: {
            files: [dayFile(SOURCE), dayFile(TARGET)].sort(),
            started: undefined,
            items: [item],
            link: 'https://example.com/atlas',
            sourceHasItem: copy,
          },
        })

        await writeDay(DayDocument.createFutureDay(TARGET).addItem(list, 'Existing plan'), timeDir)
        await writeDay(source, timeDir)
        await invoke()
        assert({
          given: 'a destination that already has a plan',
          should: 'retain its existing work while adding the moved item',
          actual: (await readDay(TARGET, timeDir)).lists
            .find((section) => section.title === list)
            ?.items.includes('Existing plan'),
          expected: true,
        })
      } finally {
        sweep.mockRestore()
      }
    })
  })

  test(`${name} leaves the source intact when destination creation fails and skips empty carries`, async () => {
    await withDayNotebook(async (notebook) => {
      const timeDir = notebook.context.config.DIR_TIME
      const targetFile = path.join(timeDir, dayFile(TARGET))
      const sourceFile = path.join(timeDir, dayFile(SOURCE))
      const invoke = () =>
        command.run({
          ...notebook,
          args: { old: SOURCE, new: TARGET, category: list, noIncomplete: false },
        })
      await writeDay(DayDocument.createFutureDay(SOURCE).addItem(list, '~~Already finished~~'), timeDir)
      const empty = await invoke()
      assert({
        given: 'no unfinished work to move or copy',
        should: 'succeed without creating a destination',
        actual: [empty.ok, await exists(targetFile)],
        expected: [true, false],
      })

      await writeDay(DayDocument.createFutureDay(SOURCE).addItem(list, item), timeDir)
      const before = await readTextFile(sourceFile)
      await outputFile(path.dirname(targetFile), 'A file prevents this directory from being created.')
      let failed = false
      try {
        await invoke()
      } catch {
        failed = true
      }
      assert({
        given: 'a destination that cannot be created',
        should: 'fail before sweeping or removing any source items',
        actual: [failed, await readTextFile(sourceFile)],
        expected: [true, before],
      })
    })
  })
}
