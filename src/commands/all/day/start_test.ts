import { spyOn } from 'bun:test'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import { ensureDay } from '#lib/nbfs/mod.ts'
import * as streaks from '#lib/streaks/mod.ts'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from './_testNotebook.ts'
import DayStart from './start.ts'

for (const ymd of ['2031-03-16', '2025-12-31', '2026-01-01']) {
  test(`day:start creates only the requested day: ${ymd}`, async () => {
    await withDayNotebook(async (notebook) => {
      const { context, tasks } = notebook
      const day = new PlainDate(ymd)
      const run = spyOn(tasks, 'run').mockResolvedValue(CommandResult.success())
      const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
      try {
        const result = await new DayStart().run({
          ...notebook,
          args: { day, tz: 'UTC', journal: false, skipLocation: true },
        })
        const doc = await readDay(day, context.config.DIR_TIME)
        assert({
          given: 'a fresh notebook on a Sunday or at a year boundary',
          should: 'start exactly that date without preparing a different week',
          actual: {
            ok: result.ok,
            files: (await readdir(context.config.DIR_TIME, { recursive: true })).filter((file) => file.endsWith('.md')),
            day: doc.day.ymd,
            started: Boolean(doc.started),
            zone: doc.timezone,
            commands: run.mock.calls.map(([name]) => name),
          },
          expected: {
            ok: true,
            files: [dayFile(day)],
            day: ymd,
            started: true,
            zone: 'UTC',
            commands: ['day:meeting:check'],
          },
        })
      } finally {
        fetch.mockRestore()
        run.mockRestore()
      }
    })
  })
}

test('day:start preserves a prepared plan and reconciles streaks without duplicating them', async () => {
  await withDayNotebook(async (notebook) => {
    const { context, tasks } = notebook
    const day = new PlainDate('2031-03-16')
    const timeDir = context.config.DIR_TIME
    await ensureDay(day, timeDir)
    const prepared = (await readDay(day, timeDir))
      .addTodoItem('Review Atlas')
      .addList('Streaks')
      .addItem('Streaks', '~~Read a chapter~~')
    await writeDay(prepared, timeDir)
    for (const [name, title] of [
      ['read', 'Read a chapter'],
      ['walk', 'Take a walk'],
    ]) {
      await outputFile(
        path.join(context.config.DIR_STREAKS, 'active', `${name}.md`),
        `---\nname: ${name}\ntitle: ${title}\nstart: 2031-01-01\n---\n\n# ${title}\n`,
      )
    }
    const run = spyOn(tasks, 'run').mockResolvedValue(CommandResult.success())
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    // This lifecycle test does not need the counter's separate notebook history scan.
    const counts = spyOn(streaks, 'computeStreakCounts').mockResolvedValue(new Map())
    try {
      const input = { ...notebook, args: { day, tz: 'UTC', journal: false, skipLocation: true } }
      await new DayStart().run(input)
      await new DayStart().run(input)
      const doc = await readDay(day, timeDir)
      assert({
        given: 'a preplanned day with a completed streak, a new active streak, and a repeated start',
        should: 'keep the plan and completed item, and add each newly active streak once',
        actual: {
          todos: doc.lists.find((list) => list.title === 'Professional Todos')?.items,
          streaks: doc.lists.find((list) => list.title === 'Streaks')?.items,
          started: Boolean(doc.started),
        },
        expected: { todos: ['Review Atlas'], streaks: ['~~Read a chapter~~', 'Take a walk'], started: true },
      })
    } finally {
      counts.mockRestore()
      fetch.mockRestore()
      run.mockRestore()
    }
  })
})

const startupFailures = [
  { name: 'returned failure', outcome: CommandResult.fail('Mock import failed', { retry: 'mock:import' }) },
  { name: 'returned error', outcome: CommandResult.error(new Error('Mock import error')) },
  { name: 'thrown exception', outcome: new Error('Mock import exception') },
]

for (const { name, outcome } of startupFailures) {
  for (const state of ['missing', 'prepared', 'ended']) {
    test(`day:start preserves a ${state} day after a startup ${name}`, async () => {
      await withDayNotebook(async (notebook) => {
        const context = notebook.context.fork({
          config: { ...notebook.context.config, DAY_START_COMMANDS: ['mock:prepare', 'mock:import'] },
        })
        const tasks = new CommandService(context)
        const day = new PlainDate('2031-03-16')
        const timeDir = context.config.DIR_TIME
        const file = path.join(timeDir, dayFile(day))
        let before: string | undefined
        if (state !== 'missing') {
          let doc = DayDocument.createFutureDay(day).addTodoItem('Existing plan').setTimezone('UTC')
          if (state === 'ended') {
            doc = doc
              .setStarted(new ZonedDateTime('2031-03-16T08:00:00', 'UTC'))
              .setEnded(new ZonedDateTime('2031-03-16T17:00:00', 'UTC'))
          }
          await writeDay(doc, timeDir)
          before = await readTextFile(file)
        }
        const run = spyOn(tasks, 'run').mockImplementation(async (command) => {
          if (command !== 'mock:import') return CommandResult.success()
          if (outcome instanceof Error) throw outcome
          return outcome
        })
        const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
        const loadStreaks = spyOn(streaks, 'loadStreaks').mockResolvedValue([])
        try {
          const result = await new DayStart().run({
            ...notebook,
            context,
            tasks,
            args: { day, tz: undefined, journal: true, skipLocation: false },
          })
          const after = await readTextFile(file)
          assert({
            given: `a ${state} day and a startup command with a ${name}`,
            should: 'surface the original failure, preserve existing bytes and skip start metadata and follow-up steps',
            actual: {
              result,
              originalOutcome: outcome instanceof Error ? result.error === outcome : result === outcome,
              preserved: before === undefined ? !(await readDay(day, timeDir)).started : after === before,
              commands: run.mock.calls.map(([command]) => command),
              streaksLoaded: loadStreaks.mock.calls.length,
            },
            expected: {
              result: outcome instanceof Error ? CommandResult.error(outcome) : outcome,
              originalOutcome: true,
              preserved: true,
              commands: ['day:meeting:check', 'mock:prepare', 'mock:import'],
              streaksLoaded: 0,
            },
          })
        } finally {
          loadStreaks.mockRestore()
          fetch.mockRestore()
          run.mockRestore()
        }
      })
    })
  }
}

for (const { name, outcome } of [{ name: 'success', outcome: CommandResult.success() }, ...startupFailures]) {
  test(`day:start waits for every startup command after a ${name}`, async () => {
    await withDayNotebook(async (notebook) => {
      const context = notebook.context.fork({
        config: { ...notebook.context.config, DAY_START_COMMANDS: ['mock:import', 'mock:slow'] },
      })
      const tasks = new CommandService(context)
      const day = new PlainDate('2031-03-16')
      const timeDir = context.config.DIR_TIME
      const slowStarted = Promise.withResolvers<void>()
      const releaseSlow = Promise.withResolvers<void>()
      let slowWork: Promise<CommandResult> | undefined
      const run = spyOn(tasks, 'run').mockImplementation(async (command) => {
        if (command === 'mock:import') {
          if (outcome instanceof Error) throw outcome
          return outcome
        }
        if (command === 'mock:slow') {
          slowWork = (async () => {
            slowStarted.resolve()
            await releaseSlow.promise
            const doc = await readDay(day, timeDir)
            await writeDay(doc.addTodoItem('Imported task'), timeDir)
            return CommandResult.success()
          })()
          return slowWork
        }
        return CommandResult.success()
      })
      const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
      const succeeded = !(outcome instanceof Error) && outcome.ok
      let finished = false
      const pending = new DayStart()
        .run({
          ...notebook,
          context,
          tasks,
          args: { day, tz: undefined, journal: true, skipLocation: false },
        })
        .then((result) => {
          finished = true
          return result
        })
      try {
        await slowStarted.promise
        await setImmediate()
        const finishedBeforeRelease = finished
        const startedBeforeRelease = Boolean((await readDay(day, timeDir)).started)
        releaseSlow.resolve()
        const result = await pending
        await slowWork
        const doc = await readDay(day, timeDir)
        assert({
          given: `one startup command with a ${name} while another is still writing the day`,
          should: 'wait for the writer, keep its edits and only finish starting the day when all commands succeed',
          actual: {
            result,
            finishedBeforeRelease,
            startedBeforeRelease,
            started: Boolean(doc.started),
            todos: doc.lists.find((list) => list.title === 'Professional Todos')?.items,
            commands: run.mock.calls.map(([command]) => command),
          },
          expected: {
            result: outcome instanceof Error ? CommandResult.error(outcome) : outcome,
            finishedBeforeRelease: false,
            startedBeforeRelease: false,
            started: succeeded,
            todos: ['Imported task'],
            commands: [
              'day:meeting:check',
              'mock:import',
              'mock:slow',
              ...(succeeded ? ['day:location', 'day:timezone', 'journal:new'] : []),
            ],
          },
        })
      } finally {
        releaseSlow.resolve()
        await Promise.allSettled([pending, slowWork])
        fetch.mockRestore()
        run.mockRestore()
      }
    })
  })
}

// Compiled by dev:typecheck; startup commands can return arbitrary failure data.
async function _verifyStartResultTypes(tasks: CommandService) {
  const result = await tasks.run('day:start')
  // @ts-expect-error a forwarded failure can carry data
  const empty: undefined = result.data
  // @ts-expect-error callers must narrow unknown failure data before using it
  const retry: string = result.data?.retry
}
