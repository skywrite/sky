import { spyOn } from 'bun:test'
import * as path from 'node:path'
import { planSections } from '#lib/nbfs/listBlocks.ts'
import { readScheduledItem } from '#lib/nbfs/scheduledItems.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from './_testNotebook.ts'
import MoveCommitments from './commitments/move-future.ts'
import AddItems from './items/add.ts'
import AddReminder from './reminders/add.ts'
import CopyReminders from './reminders/copy-future.ts'
import MoveReminders from './reminders/move-future.ts'
import ImportSchedule from './schedule/update.ts'
import DayStart from './start.ts'
import AddTodo from './todo/add.ts'
import MoveTodos from './todo/move-future.ts'

const TODAY = new PlainDate('2031-03-16')
const LATER = TODAY.addDays(1)

test('CLI adds prepare missing current-week days and schedule every type beyond Sunday', async () => {
  await withDayNotebook(async (notebook) => {
    const { config } = notebook.context
    const future = DayDocument.createFutureDay(LATER).addTodoItem('Existing future plan').toMarkdown()
    await outputFile(path.join(config.DIR_TIME, dayFile(LATER)), future)
    for (const when of [TODAY, LATER]) {
      await new AddTodo().run({
        ...notebook,
        args: { task: 'Review Atlas', category: 'Professional', when, link: undefined },
      })
      await new AddReminder().run({ ...notebook, args: { task: 'Water the plants', when, link: undefined } })
      for (const time of [undefined, '25:30']) {
        const result = await new AddItems().run({
          ...notebook,
          args: {
            task: time ? 'Call Jane Doe' : 'Review the draft',
            notes: undefined,
            list: 'commitments',
            category: 'Personal',
            when,
            time,
          },
        })
        assert({
          given: `a commitment assigned to ${when.ymd}`,
          should: 'report its actual destination',
          actual: result.data?.filed,
          expected: when === TODAY ? 'day' : 'schedule',
        })
      }
    }
    const today = await readDay(TODAY, config.DIR_TIME)
    const personal = await readTextFile(config.FILE_SCHEDULE_PERSONAL)
    const rows = planSections(personal)
      .flatMap((section) => section.rows)
      .filter((row) => row.raw)
    assert({
      given: 'a missing current day and an already-existing next-week file',
      should: 'prepare only today, leave the future plan byte-for-byte intact, and preserve scheduled list types',
      actual: {
        started: today.started,
        todos: today.lists.find((list) => list.title === 'Professional Todos')?.items,
        future: await readTextFile(path.join(config.DIR_TIME, dayFile(LATER))),
        types: rows.map((row) => readScheduledItem(row.block, 'Personal').list),
        professional: (await readTextFile(config.FILE_SCHEDULE_PROFESSIONAL)).includes('Review Atlas'),
      },
      expected: {
        started: undefined,
        todos: ['Review Atlas'],
        future,
        types: ['Reminders', 'Personal Commitments', 'Personal Commitments'],
        professional: true,
      },
    })
  })
})

for (const [command, list, copy] of [
  [new MoveTodos(), 'Professional Todos', false],
  [new MoveCommitments(), 'Personal Commitments', false],
  [new MoveReminders(), 'Reminders', false],
  [new CopyReminders(), 'Reminders', true],
] as const) {
  test(`${command.constructor.name} schedules next-week blocks without losing links or notes`, async () => {
    await withDayNotebook(async (notebook) => {
      const { config } = notebook.context
      const source = `---\n---\n\n## ${list}\n\n- Review [Atlas][brief]\n  Keep [notes](notes.md).\n  - Nested detail\n- ~~Finished~~\n\n[brief]: https://example.com/atlas\n`
      const sourceFile = path.join(config.DIR_TIME, dayFile(TODAY))
      await outputFile(sourceFile, source)
      await command.run({ ...notebook, args: { old: TODAY, new: LATER, category: list, noIncomplete: false } })
      const scheduled = await readTextFile(
        list.startsWith('Professional') ? config.FILE_SCHEDULE_PROFESSIONAL : config.FILE_SCHEDULE_PERSONAL,
      )
      assert({
        given: 'a task with attached notes and reference/relative links moved beyond this week',
        should: 'keep the task in the schedule, never create the future day, and honor move versus copy',
        actual: {
          created: await exists(path.join(config.DIR_TIME, dayFile(LATER))),
          link: scheduled.includes('[Atlas](https://example.com/atlas)'),
          notes: scheduled.includes('  - Nested detail'),
          original: planSections(await readTextFile(sourceFile))
            .find((section) => section.title === list)
            ?.rows.some((row) => row.raw === 'Review [Atlas][brief]'),
          type: readScheduledItem(
            planSections(scheduled)[0].rows[0].block,
            list.startsWith('Professional') ? 'Professional' : 'Personal',
          ).list,
        },
        expected: { created: false, link: true, notes: true, original: copy, type: list },
      })
    })
  })
}

test('day:start imports legacy and typed scheduled blocks into an existing plan, exactly once', async () => {
  await withDayNotebook(async (notebook) => {
    const { config } = notebook.context
    // A prior import saved one item before it could drain the schedule.
    await writeDay(
      DayDocument.createFutureDay(LATER).addTodoItem('Already planned').addTodoItem('Legacy todo'),
      config.DIR_TIME,
    )
    await outputFile(
      config.FILE_SCHEDULE_PROFESSIONAL,
      `# Schedule\n\n## ${LATER.ymd}\n\n- Legacy todo\n- 09:00 > Legacy call\n- Untimed promise <!-- sky-list: Professional Commitments -->\n`,
    )
    await outputFile(
      config.FILE_SCHEDULE_PERSONAL,
      `# Schedule\n\n## ${LATER.ymd}\n\n- Review [Atlas][brief] <!-- sky-list: Reminders -->\n  Keep this note.\n  - Nested detail\n\n[brief]: https://example.com/atlas\n`,
    )
    const context = notebook.context.fork({ config: { ...config, DAY_START_COMMANDS: ['day:schedule:update'] } })
    const run = spyOn(notebook.tasks, 'run').mockImplementation(async (name, args) => {
      if (name === 'day:schedule:update')
        return new ImportSchedule().run({ ...notebook, context, args: { day: args?.day as PlainDate } })
      return { ok: true } as never
    })
    try {
      await new DayStart().run({
        ...notebook,
        context,
        args: { day: LATER, skipLocation: true, journal: false, tz: 'UTC' },
      })
      await new ImportSchedule().run({ ...notebook, args: { day: LATER } })
      const content = await readTextFile(path.join(config.DIR_TIME, dayFile(LATER)))
      const doc = DayDocument.fromMarkdown(content)
      assert({
        given: 'scheduled todos, timed/untimed commitments, and a reminder with notes on a preplanned day',
        should: 'import to the original lists, preserve the plan and links, and drain scheduled items only once',
        actual: {
          todos: doc.lists.find((list) => list.title === 'Professional Todos')?.items,
          commitments: doc.lists.find((list) => list.title === 'Professional Commitments')?.items,
          reminders: planSections(content).find((section) => section.title === 'Reminders')?.rows.length,
          notes: content.includes('  - Nested detail'),
          link: content.includes('[Atlas](https://example.com/atlas)'),
          metadata: content.includes('sky-list:'),
          scheduleHasTask: (await readTextFile(config.FILE_SCHEDULE_PERSONAL)).includes('Review'),
        },
        expected: {
          todos: ['Already planned', 'Legacy todo'],
          commitments: ['09:00 > Legacy call', 'Untimed promise'],
          reminders: 1,
          notes: true,
          link: true,
          metadata: false,
          scheduleHasTask: false,
        },
      })
    } finally {
      run.mockRestore()
    }
  })
})

test('a failed scheduled destination leaves the CLI source unchanged', async () => {
  await withDayNotebook(async (notebook) => {
    const { config } = notebook.context
    await writeDay(DayDocument.createFutureDay(TODAY).addTodoItem('Review Atlas'), config.DIR_TIME)
    const file = path.join(config.DIR_TIME, dayFile(TODAY))
    const before = await readTextFile(file)
    const context = notebook.context.fork({
      config: { ...config, FILE_SCHEDULE_PROFESSIONAL: path.join(file, 'blocked.md') },
    })
    let failed = false
    try {
      await new MoveTodos().run({
        ...notebook,
        context,
        args: { old: TODAY, new: LATER, category: 'Professional Todos', noIncomplete: false },
      })
    } catch {
      failed = true
    }
    assert({
      given: 'an unwritable schedule destination',
      should: 'fail without sweeping the source',
      actual: [failed, await readTextFile(file)],
      expected: [true, before],
    })
  })
})
