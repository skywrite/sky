import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#config'
import { dayFile } from '#lib/nbfs/mod.ts'
import { withLock } from '#lib/outbox/files.ts'
import { workstreamStoragePaths } from '#lib/workstreams/storagePaths.ts'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import DayTodoAddTask from '../todo/add.ts'
import DayItemsAddTask from './add.ts'
import DayItemsDoneTask from './done.ts'

const DAY = new PlainDate('2031-03-16')
const TASKS = ['Draft the Q2 roadmap', 'Review the Atlas deck', 'Book the offsite room', 'Send Jane the agenda']

/** A temp notebook whose locks and schedule files stay inside it. */
async function notebook(run: (n: { context: CommandContext; file: string; schedule: string }) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-day-items-test-'))
  const timeDir = path.join(root, 'time')
  const schedule = path.join(timeDir, 'schedule-professional.md')
  const context = CommandContext.test(
    {
      ...config,
      DIR_BASE: root,
      DIR_STATE: path.join(root, 'state'),
      DIR_TIME: timeDir,
      FILE_SCHEDULE_PROFESSIONAL: schedule,
      FILE_SCHEDULE_PERSONAL: path.join(timeDir, 'schedule-personal.md'),
    },
    { notebookNow: new ZonedDateTime('2031-03-13T08:00:00', 'UTC') },
  )
  try {
    await run({ context, file: path.join(timeDir, dayFile(DAY)), schedule })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const call = (context: CommandContext) => ({ context, tasks: new CommandService(context), rawArgs: { _: [] } })

test('day:items:add - adds sent at once all land', async () => {
  await notebook(async ({ context, file }) => {
    await outputFile(file, DayDocument.createFutureDay(DAY).toMarkdown())

    // A chat model asked for four todos sends four tool calls in one step.
    const results = await Promise.all(
      TASKS.map((task) =>
        new DayItemsAddTask().run({
          args: { task, list: 'todos', category: 'Professional', time: undefined, when: DAY },
          ...call(context),
        }),
      ),
    )
    const todos = DayDocument.fromMarkdown(await readTextFile(file)).lists.find(
      (list) => list.title === 'Professional Todos',
    )

    assert({
      given: 'four adds to the same day, started together',
      should: 'report four successes and keep all four items',
      actual: { statuses: results.map((r) => r.status), items: [...(todos?.items ?? [])].sort() },
      expected: { statuses: ['success', 'success', 'success', 'success'], items: [...TASKS].sort() },
    })
  })
})

test('day:items:add - waits while the day page writes the same day', async () => {
  await notebook(async ({ context, file }) => {
    await outputFile(file, DayDocument.createFutureDay(DAY).toMarkdown())
    // The lock as service/handler/day/item.ts spells it. A rename on either side fails here.
    const pageLock = path.join(workstreamStoragePaths(context.config).stateDir, `day-${DAY.ymd}.lock`)

    let landedWhileHeld = true
    let adding: Promise<unknown> = Promise.resolve()
    await withLock(pageLock, async () => {
      adding = new DayItemsAddTask().run({
        args: { task: TASKS[0], list: 'todos', category: 'Professional', time: undefined, when: DAY },
        ...call(context),
      })
      await delay(120)
      landedWhileHeld = (await readTextFile(file)).includes(TASKS[0])
    })
    await adding

    assert({
      given: 'an add started while the day page holds the lock for that day',
      should: 'write only after the page lets go',
      actual: { landedWhileHeld, landedAfter: (await readTextFile(file)).includes(TASKS[0]) },
      expected: { landedWhileHeld: false, landedAfter: true },
    })
  })
})

test('day:items:done - strikes sent at once all stay struck', async () => {
  await notebook(async ({ context, file }) => {
    let day = DayDocument.createFutureDay(DAY)
    for (const task of TASKS) day = day.addTodoItem(task, { category: 'Professional' })
    await outputFile(file, day.toMarkdown())

    await Promise.all(
      ['roadmap', 'offsite'].map((item) =>
        new DayItemsDoneTask().run({ args: { item, list: undefined, when: DAY }, ...call(context) }),
      ),
    )
    const after = await readTextFile(file)

    assert({
      given: 'two strikes on the same day, started together',
      should: 'keep both strikes',
      actual: [after.includes('~~Draft the Q2 roadmap~~'), after.includes('~~Book the offsite room~~')],
      expected: [true, true],
    })
  })
})

test('day:todo:add - adds sent at once for next week all reach the schedule', async () => {
  await notebook(async ({ context, schedule }) => {
    await outputFile(schedule, '# Schedule\n')

    await Promise.all(
      TASKS.map((task) =>
        new DayTodoAddTask().run({
          args: { task, category: 'Professional Todos', link: undefined, when: DAY.addDays(1) },
          ...call(context),
        }),
      ),
    )
    const after = await readTextFile(schedule)

    assert({
      given: 'four todos for one future date, started together',
      should: 'file all four under that date',
      actual: TASKS.filter((task) => after.includes(`- ${task}`)).length,
      expected: 4,
    })
  })
})
