import { setSystemTime, spyOn } from 'bun:test'
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from './_testNotebook.ts'
import type RecurringUpdate from './recurring/update.ts'
import type RemindersUpdate from './reminders/update.ts'
import DayStart from './start.ts'

const PAST = new PlainDate('2031-03-15')
const TODAY = new PlainDate('2031-03-16')
const FUTURE = new PlainDate('2031-03-17')
const DAYS = [PAST, TODAY, FUTURE]
const COMMANDS = ['day:recurring:update', 'day:reminders:update'] as const
type Notebook = Parameters<Parameters<typeof withDayNotebook>[0]>[0]

function recurringSource(category: string): string {
  return `# Recurring ${category}

## EVERY-DAY
- Daily ${category} task
- 10:00 > Daily ${category} commitment

## Saturday
- Past ${category} task

## Sunday
- Today ${category} task

## EVERY-MON
- Future ${category} task
`
}

async function withRecurringNotebook(run: (notebook: Notebook) => Promise<void>) {
  // Freeze local noon through nbdt so today's date is independent of the machine's timezone.
  setSystemTime(new ZonedDateTime('2031-03-16T12:00:00').epochMilliseconds)
  try {
    await withDayNotebook(async (notebook) => {
      const { config } = notebook.context
      await outputFile(config.FILE_RECURRING_PROFESSIONAL, recurringSource('professional'))
      await outputFile(config.FILE_RECURRING_PERSONAL, recurringSource('personal'))
      await outputFile(
        config.FILE_REMINDERS,
        `# Reminders

## EVERY-DAY
- Daily reminder

## Saturday
- Past reminder

## Sunday
- Today reminder

## EVERY-MON
- Future reminder
`,
      )
      for (const day of DAYS) {
        await writeDay(
          DayDocument.createFutureDay(day).addTodoItem('Existing plan').addReminderItem('Existing reminder'),
          config.DIR_TIME,
        )
      }
      await run(notebook)
    })
  } finally {
    setSystemTime()
  }
}

async function snapshots(notebook: Notebook): Promise<string[]> {
  return Promise.all(DAYS.map((day) => readTextFile(path.join(notebook.context.config.DIR_TIME, dayFile(day)))))
}

async function lists(notebook: Notebook, day: PlainDate) {
  const doc = await readDay(day, notebook.context.config.DIR_TIME)
  const items = (title: string) => doc.lists.find((list) => list.title === title)?.items ?? []
  return {
    professionalTodos: items('Professional Todos'),
    professionalCommitments: items('Professional Commitments'),
    personalTodos: items('Personal Todos'),
    personalCommitments: items('Personal Commitments'),
    reminders: items('Reminders'),
    started: Boolean(doc.started),
  }
}

function expectedLists(label: 'Past' | 'Today' | 'Future', recurring: boolean, reminders: boolean) {
  return {
    professionalTodos: [
      'Existing plan',
      ...(recurring ? ['Daily professional task', `${label} professional task`] : []),
    ],
    professionalCommitments: recurring ? ['10:00 > Daily professional commitment'] : [],
    personalTodos: recurring ? ['Daily personal task', `${label} personal task`] : [],
    personalCommitments: recurring ? ['10:00 > Daily personal commitment'] : [],
    reminders: ['Existing reminder', ...(reminders ? ['Daily reminder', `${label} reminder`] : [])],
    started: false,
  }
}

const cases: Array<{
  given: string
  day: PlainDate
  label: 'Past' | 'Today' | 'Future'
  parent?: { day: PlainDate }
  overrides?: { day: PlainDate }
}> = [
  { given: 'an explicit past day', day: PAST, label: 'Past', overrides: { day: PAST } },
  { given: 'an explicit future day', day: FUTURE, label: 'Future', overrides: { day: FUTURE } },
  { given: 'an inherited day', day: PAST, label: 'Past', parent: { day: PAST } },
  {
    given: 'an override of an inherited day',
    day: FUTURE,
    label: 'Future',
    parent: { day: PAST },
    overrides: { day: FUTURE },
  },
  { given: 'no day', day: TODAY, label: 'Today' },
]

for (const name of COMMANDS) {
  for (const { given, day, label, parent, overrides } of cases) {
    test(`${name} uses ${given} for matching and writing`, async () => {
      await withRecurringNotebook(async (notebook) => {
        const before = await snapshots(notebook)
        const tasks = new CommandService(notebook.context, parent)
        const result = await tasks.run(name, overrides)
        // Existing reminder deduplication must also use the selected day's contents.
        if (name === 'day:reminders:update') await tasks.run(name, overrides)
        const after = await snapshots(notebook)
        assert({
          given,
          should:
            'use that day for recurrence matching, preserve its plan and leave other days byte-for-byte unchanged',
          actual: {
            status: result.status,
            lists: await lists(notebook, day),
            otherDaysUnchanged: DAYS.every((candidate, i) => candidate.ymd === day.ymd || after[i] === before[i]),
          },
          expected: {
            status: 'success',
            lists: expectedLists(label, name === 'day:recurring:update', name === 'day:reminders:update'),
            otherDaysUnchanged: true,
          },
        })
      })
    })
  }

  test(`${name} parses serialized dates and rejects invalid dates before writing`, async () => {
    await withRecurringNotebook(async (notebook) => {
      const tasks = new CommandService(notebook.context, { day: PAST })
      const dynamicName: string = name
      const before = await snapshots(notebook)
      const result = await tasks.run(dynamicName, { day: FUTURE.ymd })
      const valid = await snapshots(notebook)
      let rejected = false
      try {
        await tasks.run(dynamicName, { day: '2031-02-30' })
      } catch {
        rejected = true
      }
      assert({
        given: 'an external date string overriding an inherited date, followed by an invalid date',
        should: 'write only the parsed target and reject the invalid date without further writes',
        actual: {
          status: result.status,
          lists: await lists(notebook, FUTURE),
          otherDaysUnchanged: valid[0] === before[0] && valid[1] === before[1],
          rejected,
          unchangedAfterInvalid: (await snapshots(notebook)).every((content, i) => content === valid[i]),
        },
        expected: {
          status: 'success',
          lists: expectedLists('Future', name === 'day:recurring:update', name === 'day:reminders:update'),
          otherDaysUnchanged: true,
          rejected: true,
          unchangedAfterInvalid: true,
        },
      })
    })
  })
}

for (const startDay of [false, true]) {
  test(`${startDay ? 'day:start' : 'day:sr:update'} puts all three update types on the selected day`, async () => {
    await withRecurringNotebook(async (notebook) => {
      const { config } = notebook.context
      const todayFile = path.join(config.DIR_TIME, dayFile(TODAY))
      const pastFile = path.join(config.DIR_TIME, dayFile(PAST))
      const pastBefore = await readTextFile(pastFile)
      await rm(todayFile)
      await outputFile(config.FILE_SCHEDULE_PROFESSIONAL, `# Schedule\n\n## ${FUTURE.ymd}\n\n- Scheduled task\n`)
      const context = notebook.context.fork({ config: { ...config, DAY_START_COMMANDS: ['day:sr:update'] } })
      const tasks = new CommandService(context)
      const execute = tasks.run.bind(tasks)
      // Only the external meeting check and heartbeat are replaced; all three file-writing updates run.
      const run = spyOn(tasks, 'run').mockImplementation(async (name, overrides) =>
        name === 'day:meeting:check' ? CommandResult.success() : execute(name, overrides),
      )
      const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
      try {
        const result = startDay
          ? await new DayStart().run({
              ...notebook,
              context,
              tasks,
              args: { day: FUTURE, tz: 'UTC', skipLocation: true, journal: false },
            })
          : await tasks.run('day:sr:update', { day: FUTURE })
        const expected = expectedLists('Future', true, true)
        expected.professionalTodos.push('Scheduled task')
        expected.started = startDay
        assert({
          given: 'a selected future day and no file for the system date',
          should: 'put recurring tasks, scheduled items and reminders on that day without creating today',
          actual: {
            status: result.status,
            lists: await lists(notebook, FUTURE),
            todayExists: await exists(todayFile),
            pastUnchanged: (await readTextFile(pastFile)) === pastBefore,
            scheduleDrained: !(await readTextFile(config.FILE_SCHEDULE_PROFESSIONAL)).includes('Scheduled task'),
          },
          expected: {
            status: 'success',
            lists: expected,
            todayExists: false,
            pastUnchanged: true,
            scheduleDrained: true,
          },
        })
      } finally {
        fetch.mockRestore()
        run.mockRestore()
      }
    })
  })
}

test('reminder updates preserve missing-source and no-match behavior for the selected day', async () => {
  for (const source of ['unconfigured', 'missing', 'no match']) {
    await withRecurringNotebook(async (notebook) => {
      const before = await snapshots(notebook)
      const { config } = notebook.context
      if (source === 'missing') await rm(config.FILE_REMINDERS)
      if (source === 'no match') await outputFile(config.FILE_REMINDERS, '# Reminders\n\n## Sunday\n- Today only\n')
      const context =
        source === 'unconfigured'
          ? notebook.context.fork({ config: { ...config, FILE_REMINDERS: '' } })
          : notebook.context
      const result = await new CommandService(context).run('day:reminders:update', { day: PAST })
      assert({
        given: `a reminder source that is ${source}`,
        should: 'preserve the existing outcome and leave every day unchanged',
        actual: {
          status: result.status,
          unchanged: (await snapshots(notebook)).every((content, i) => content === before[i]),
        },
        expected: { status: source === 'unconfigured' ? 'fail' : 'success', unchanged: true },
      })
    })
  }
})

// Compiled by dev:typecheck; never executed. Cover handler inputs and registration.
function _verifyUpdateTypes(
  tasks: CommandService,
  recurring: Parameters<RecurringUpdate['run']>[0],
  reminders: Parameters<RemindersUpdate['run']>[0],
) {
  tasks.run('day:recurring:update')
  tasks.run('day:reminders:update')
  tasks.run('day:recurring:update', { day: PAST })
  tasks.run('day:reminders:update', { day: FUTURE })
  // @ts-expect-error the recurring handler must not receive any
  const recurringText: string = recurring.args.day
  // @ts-expect-error the reminders handler must not receive any
  const reminderText: string = reminders.args.day
  // @ts-expect-error invalid dates cannot fall through to unregistered command typing
  tasks.run('day:recurring:update', { day: 123 })
  // @ts-expect-error a misspelled date must not silently select today
  tasks.run('day:reminders:update', { day: FUTURE, dya: FUTURE })
  // @ts-expect-error sequential batches must keep checking each registered date
  tasks.runSequential([['day:recurring:update', { day: false }]])
  // @ts-expect-error parallel batches must keep checking each registered date
  tasks.runParallel([['day:reminders:update', { day: 123 }]])
}
