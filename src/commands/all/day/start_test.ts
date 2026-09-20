import { spyOn } from 'bun:test'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { CommandResult } from '#commands/mod.ts'
import { ensureDay } from '#lib/nbfs/mod.ts'
import * as streaks from '#lib/streaks/mod.ts'
import { outputFile } from '#shared/fs/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
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
