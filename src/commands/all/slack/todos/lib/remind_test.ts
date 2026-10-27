import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { withDayNotebook } from '#commands/all/day/_testNotebook.ts'
import type { LaterCaptureRow } from '#commands/all/slack/saved/lib/capture.ts'
import { planSections } from '#lib/nbfs/listBlocks.ts'
import { outputFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { addTodoReminder } from './remind.ts'

const row = (second = 1): LaterCaptureRow => ({
  item: {
    channel_id: 'C0ATLAS',
    channel_name: 'atlas',
    ts: `1740000000.00000${second}`,
    message: { content: 'Review the Atlas proposal' },
  },
  timeLabel: '2025-02-19 10:00',
  link: `https://atlas.slack.com/archives/C0ATLAS/p174000000000000${second}`,
})

test('Slack to-do reminders prepare an unstarted day and preserve concurrent additions', async () => {
  await withDayNotebook(async ({ context }) => {
    const added = await Promise.all([
      addTodoReminder(row(), context),
      addTodoReminder(row(), context),
      addTodoReminder(row(2), context),
    ])
    const contents = await readFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')), 'utf8')
    const reminders = planSections(contents).find((section) => section.title === 'Reminders')!
    assert({
      given: 'concurrent captures of two messages, one requested twice, into a new day',
      should: 'create the day without starting it, retain distinct messages, and add the duplicate only once',
      actual: [
        added.filter(Boolean).length,
        DayDocument.fromMarkdown(contents).started,
        reminders.rows.map((item) => item.raw).sort(),
      ],
      expected: [
        2,
        undefined,
        [`[Review the Atlas proposal](${row().link})`, `[Review the Atlas proposal](${row(2).link})`],
      ],
    })
  })
})

test('Slack to-do retries preserve edited, completed and moved reminders with either link form', async () => {
  await withDayNotebook(async ({ context }) => {
    const file = path.join(context.config.DIR_TIME, dayFile('2031-03-16'))
    for (const section of ['Reminders', 'Professional Todos']) {
      for (const source of [`[Slack](${row().link})`, '[Source][atlas-message]']) {
        const contents = `---\ncreated: 2031-03-16\n---\n\n# Keep this plan\n\n## ${section}\n\n- ~~Edited action ${source}~~\n  Keep these notes.\n\n[atlas-message]: ${row().link}\n`
        await outputFile(file, contents)
        const added = await addTodoReminder(row(), context)
        assert({
          given: 'the source message already belongs to an edited, completed or moved action',
          should: 'preserve the whole day byte for byte instead of recreating the reminder',
          actual: [added, await readFile(file, 'utf8')],
          expected: [false, contents],
        })
      }
    }
  })
})

test("Slack to-do reminders use today's notebook-zone calendar date and work without a started day", async () => {
  await withDayNotebook(async ({ context }) => {
    const systemNow = new ZonedDateTime('2031-03-17T02:00:00', 'UTC')
    for (const clock of [
      { notebookNow: new ZonedDateTime('2031-03-16T21:00:00', 'America/Chicago'), systemNow, expected: '2031-03-16' },
      { notebookNow: new ZonedDateTime('2031-03-16T25:30:00', 'America/Chicago'), systemNow, expected: '2031-03-17' },
      {
        get notebookNow(): ZonedDateTime {
          throw new Error('No started day')
        },
        systemNow,
        expected: '2031-03-17',
      },
    ]) {
      await addTodoReminder(row(), {
        config: context.config,
        get notebookNow() {
          return clock.notebookNow
        },
        systemNow: clock.systemNow,
      })
      const contents = await readFile(path.join(context.config.DIR_TIME, dayFile(clock.expected)), 'utf8')
      assert({
        given: 'system and notebook dates differ, the notebook uses extended hours, or no day is started',
        should: 'file the reminder on the current planning date',
        actual: planSections(contents)
          .find((section) => section.title === 'Reminders')
          ?.rows.map((item) => item.raw),
        expected: [`[Review the Atlas proposal](${row().link})`],
      })
    }
  })
})
