import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from '../day/_testNotebook.ts'
import SummaryWeek from './week.ts'

const args = {
  week: '2031-W11',
  model: 'default-fable-5.1',
  force: false,
  allowMissing: false,
  dryRun: false,
  stdout: false,
  open: false,
  export: false,
  effort: undefined,
}

test('summary:week uses the calendar day after extended Sunday hours and preserves an existing summary', async () => {
  await withDayNotebook(async ({ context, tasks, rawArgs }) => {
    const command = new SummaryWeek()
    const sunday = await command.run({ args, context, tasks, rawArgs })
    const monday = context.fork({
      notebookNow: new ZonedDateTime(new PlainDateTime('30:00', '2031-03-16'), 'America/Chicago'),
    })
    const completed = await command.run({ args, context: monday, tasks, rawArgs })
    const file = path.join(context.config.DIR_TIME, weekDir(Week.parse(args.week).startInYear), 'summary.md')
    const saved = '# Weekly summary\n\nThe Atlas checklist is ready.\n'
    await outputFile(file, saved)
    const defaultWeek = await command.run({ args: { ...args, week: undefined }, context: monday, tasks, rawArgs })
    assert({
      given: 'Sunday, then Monday morning before another day starts, then an already saved summary',
      should: 'refuse the unfinished week, use the completed week after midnight, and keep its saved file',
      actual: [
        sunday.message?.includes("isn't complete yet"),
        completed.message,
        defaultWeek.message,
        await readTextFile(file),
      ],
      expected: [
        true,
        'No daily summaries found for this week. Run summary:day for each day first.',
        'Week summary already exists. Use --force to overwrite.',
        saved,
      ],
    })
  })
})

test('summary:week can report missing summaries before the notebook clock has been set up', async () => {
  await withDayNotebook(async ({ context: original, tasks, rawArgs }) => {
    const context = new CommandContext({
      platform: original.platform,
      config: original.config,
      env: original.env,
      output: original.output,
      secrets: original.secrets,
      systemNow: new ZonedDateTime(new PlainDateTime('08:00', '2031-03-17'), 'America/Chicago'),
    })
    const result = await new SummaryWeek().run({ args, context, tasks, rawArgs })
    assert({
      given: 'a fresh notebook without a started day',
      should: 'explain the daily-summary prerequisite using the calendar date',
      actual: result.message,
      expected: 'No daily summaries found for this week. Run summary:day for each day first.',
    })
  })
})
