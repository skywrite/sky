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
        const added = await addTodoReminder(row(), context, async () => {
          throw new Error('An existing reminder must not be rewritten')
        })
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

test('Slack reminder wording is prepared outside the day lock and keeps its source link', async () => {
  await withDayNotebook(async ({ context }) => {
    await addTodoReminder(row(), context, async () => {
      await addTodoReminder(row(2), context)
      return 'Read the Atlas proposal and send Jane feedback on pricing.'
    })
    const contents = await readFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')), 'utf8')
    assert({
      given: 'another day write completes while the model prepares a friendly reminder',
      should: 'preserve both entries and the exact Slack source without holding the write lock during generation',
      actual: planSections(contents)
        .find((section) => section.title === 'Reminders')
        ?.rows.map((item) => item.raw)
        .sort(),
      expected: [
        `[Read the Atlas proposal and send Jane feedback on pricing.](${row().link})`,
        `[Review the Atlas proposal](${row(2).link})`,
      ],
    })
  })
})

test('Slack reminder retries recognize legacy and thread-aware URLs as the same source', async () => {
  await withDayNotebook(async ({ context }) => {
    const file = path.join(context.config.DIR_TIME, dayFile('2031-03-16'))
    const reply = row()
    const legacy = reply.link
    reply.item.message!.thread_ts = '1739999999.000100'
    reply.link += '?thread_ts=1739999999.000100&cid=C0ATLAS'
    for (const section of ['Reminders', 'Professional Todos']) {
      for (const stored of [legacy, `${legacy}?cid=C0ATLAS&thread_ts=1739999999.000100`]) {
        for (const source of [`[Slack](${stored})`, '[Source][atlas-message]']) {
          const contents = `---\ncreated: 2031-03-16\n---\n\n## ${section}\n\n- ~~Edited action ${source}~~\n  Keep these notes.\n\n[atlas-message]: ${stored}\n`
          await outputFile(file, contents)
          const added = await addTodoReminder(reply, context, async () => {
            throw new Error('The same message must not generate a second reminder')
          })
          assert({
            given: 'an edited, completed or moved reminder with an old or reordered reply URL',
            should: 'recognize the source without changing the action or adding a duplicate',
            actual: [added, await readFile(file, 'utf8')],
            expected: [false, contents],
          })
        }
      }
    }
  })
})

test('Slack reminder deduplication keeps distinct replies and workspaces separate', async () => {
  await withDayNotebook(async ({ context }) => {
    const first = row()
    const second = row(2)
    const otherWorkspace = { ...row(), link: row().link.replace('atlas.slack.com', 'widget.slack.com') }
    for (const entry of [first, second, otherWorkspace]) {
      entry.link += '?thread_ts=1739999999.000100&cid=C0ATLAS'
      await addTodoReminder(entry, context)
    }
    const contents = await readFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')), 'utf8')
    assert({
      given: 'two replies in one thread and an identically numbered message in another workspace',
      should: 'keep each source as its own reminder',
      actual: planSections(contents).find((section) => section.title === 'Reminders')?.rows.length,
      expected: 3,
    })
  })
})

test('a Slack reminder added while wording is generated wins over the late rewrite', async () => {
  await withDayNotebook(async ({ context }) => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const pending = addTodoReminder(row(), context, async () => {
      started.resolve()
      await release.promise
      return 'Read the Atlas proposal and send Jane feedback.'
    })
    await started.promise
    try {
      await addTodoReminder(row(), context)
    } finally {
      release.resolve()
    }
    const added = await pending
    const contents = await readFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')), 'utf8')
    assert({
      given: 'the same source was saved before a slow model answered',
      should: 'retain the saved wording and avoid creating a second reminder',
      actual: [
        added,
        planSections(contents)
          .find((section) => section.title === 'Reminders')
          ?.rows.map((item) => item.raw),
      ],
      expected: [false, [`[Review the Atlas proposal](${row().link})`]],
    })
  })
})

test('an unavailable Slack reminder rewrite keeps capture working', async () => {
  await withDayNotebook(async ({ context }) => {
    const added = await addTodoReminder(row(), context, async () => undefined)
    const contents = await readFile(path.join(context.config.DIR_TIME, dayFile('2031-03-16')), 'utf8')
    assert({
      given: 'no usable model wording',
      should: 'save the original preview and source link',
      actual: [
        added,
        planSections(contents)
          .find((section) => section.title === 'Reminders')
          ?.rows.map((item) => item.raw),
      ],
      expected: [true, [`[Review the Atlas proposal](${row().link})`]],
    })
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
