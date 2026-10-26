import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import CommandContext, { CommandPlatform } from '#commands/lib/core/CommandContext.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import { outputFile } from '#shared/fs/mod.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { withDayNotebook } from './_testNotebook.ts'
import DayUnsummarized from './unsummarized.ts'

for (const layout of ALL_LAYOUTS) {
  test(`day:unsummarized checks summary files across gaps and year boundaries (${layout.pattern})`, async () => {
    await withDayNotebook(async (notebook) => {
      const timeDir = path.join(notebook.context.config.DIR_BASE, 'custom-calendar')
      const context = notebook.context.fork({
        config: { ...notebook.context.config, DIR_TIME: timeDir, NBFS_LAYOUT: layout.pattern },
        notebookNow: new ZonedDateTime({ date: '2031-03-16', time: '26:30', timezone: 'UTC' }),
        systemNow: new ZonedDateTime('2031-03-17T02:30:00', 'UTC'),
      })
      const file = (day: string) => path.join(timeDir, layout.dayFile(day))
      const content = '---\nended: 12h\n---\n\n## Professional Todos\n\n- Review Atlas\n'
      for (const day of [
        '2031-03-17',
        '2031-03-16',
        '2031-03-15',
        '2031-03-14',
        '2031-01-01',
        '2030-12-31',
        '2020-02-29',
      ])
        await outputFile(file(day), content)
      await outputFile(daySummaryPath(file('2031-03-14')), '')
      // A summary without a day file is already complete; a stray nested day.md is not a notebook day.
      await outputFile(daySummaryPath(file('2031-03-13')), '# Summary\n')
      await outputFile(path.join(path.dirname(file('2031-03-12')), 'actions', 'day.md'), content)
      await outputFile(path.join(timeDir, 'notes', 'day.md'), content)
      await mkdir(daySummaryPath(file('2031-01-01')))
      const before = (await readdir(timeDir, { recursive: true })).sort()
      const result = await new DayUnsummarized().run({ ...notebook, context, args: {} })
      assert({
        given: 'a late notebook day, older records with legacy end stamps, an empty saved summary, and gaps',
        should: 'list only unsummarized past days in date order without changing the notebook',
        actual: {
          ok: result.ok,
          data: result.data,
          sameFiles: JSON.stringify((await readdir(timeDir, { recursive: true })).sort()) === JSON.stringify(before),
          sameDay: (await readFile(file('2031-03-15'), 'utf8')) === content,
          summary: await readFile(daySummaryPath(file('2031-03-14')), 'utf8'),
        },
        expected: {
          ok: true,
          data: { days: ['2020-02-29', '2030-12-31', '2031-01-01', '2031-03-15'], currentDay: '2031-03-16' },
          sameFiles: true,
          sameDay: true,
          summary: '',
        },
      })
      await rm(daySummaryPath(file('2031-03-14')))
      const reopened = await new DayUnsummarized().run({ ...notebook, context, args: {} })
      assert({
        given: 'a saved summary is removed',
        should: 'include that day on the next run',
        actual: reopened.data?.days,
        expected: ['2020-02-29', '2030-12-31', '2031-01-01', '2031-03-14', '2031-03-15'],
      })
    })
  })
}

test('day:unsummarized works before any day has started and does not create a missing time tree', async () => {
  await withDayNotebook(async (notebook) => {
    const output = new BufferedOutput()
    const context = new CommandContext({
      platform: CommandPlatform.Test,
      config: notebook.context.config,
      env: {},
      output,
      notebookNowProvider: () => {
        throw new Error('No day has been started.')
      },
      systemNow: new ZonedDateTime('2031-03-17T02:30:00', 'UTC'),
    })
    const result = await new DayUnsummarized().run({ ...notebook, context, args: {} })
    assert({
      given: 'a fresh notebook with no started day or time directory',
      should: 'report no missing summaries using the calendar date and leave the notebook empty',
      actual: [
        result.data,
        await readdir(context.config.DIR_BASE),
        output.getLogs().some((line) => line.includes('No days without summaries')),
      ],
      expected: [{ days: [], currentDay: '2031-03-17' }, [], true],
    })
  })
})
