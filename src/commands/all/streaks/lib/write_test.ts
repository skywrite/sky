import * as path from 'node:path'
import { withDayNotebook } from '#commands/all/day/_testNotebook.ts'
import { SlugCollisionError, TitleCollisionError, writeStreak } from '#commands/all/streaks/lib/write.ts'
import { makeTempDir, outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const NOW = new ZonedDateTime('2026-03-05 09:15', 'America/Chicago')

test('writeStreak - writes the rule doc under active/ keyed to notebook now', async () => {
  const streaksDir = await makeTempDir({ prefix: 'streaks-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeStreak(
    {
      name: 'eat-clean',
      title: 'Eat clean',
      schedule: 'daily',
      start: new PlainDate('2026-03-09'),
      end: new PlainDate('2026-04-05'),
      why: 'Food quality drives everything else.',
      rel: ['Atlas'],
      now: NOW,
      category: 'Personal Complete',
    },
    { streaksDir, timeDir },
  )

  assert({ actual: result.file, expected: path.join(streaksDir, 'active', 'eat-clean.md') })

  const content = await readTextFile(result.file)
  assert({ actual: content.includes('name: eat-clean'), expected: true })
  assert({ actual: content.includes('category: Personal'), expected: true })
  assert({ actual: content.includes('start: 2026-03-09'), expected: true })
  assert({ actual: content.includes('end: 2026-04-05'), expected: true })
  assert({ actual: content.includes('created: 2026-03-05'), expected: true })
  assert({ actual: content.includes('- Atlas'), expected: true })

  assert({
    given: 'a start day later than the creation day',
    should: 'note the start date in the day item',
    actual: result.dayItem,
    expected: '09:15 > streaks/eat-clean -> Started | Eat clean (starts 2026-03-09)',
  })
})

test('writeStreak infers and saves the same category used for the creation day entry', async () => {
  await withDayNotebook(async ({ context }) => {
    const now = context.notebookNow
    const today = now.plainDateTime.plainDate
    const { config } = context
    const file = path.join(config.DIR_TIME, dayFile(today))
    await outputFile(file, DayDocument.createFutureDay(today).toMarkdown())
    const created = await writeStreak(
      {
        name: 'read-a-chapter',
        title: 'Read a chapter',
        why: 'Develop skills for work.',
        start: today,
        schedule: 'daily',
        now,
      },
      {
        root: config.DIR_BASE,
        timeDir: config.DIR_TIME,
        streaksDir: config.DIR_STREAKS,
        classify: async () => 'Professional',
      },
    )
    assert({
      given: 'a new CLI streak with no explicit category',
      should: 'persist the inferred category and use it in the day record',
      actual: [
        StreakDocument.fromMarkdown(await readTextFile(created.file)).category,
        DayDocument.fromMarkdown(await readTextFile(file)).lists.find((list) => list.title === 'Professional Complete')
          ?.items,
      ],
      expected: ['Professional', ['08:00 > streaks/read-a-chapter -> Started | Read a chapter']],
    })
  })
})

test('writeStreak - refuses a name collision across statuses', async () => {
  const streaksDir = await makeTempDir({ prefix: 'streaks-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'eat-clean',
    title: 'Eat clean',
    schedule: 'daily' as const,
    start: new PlainDate('2026-03-05'),
    why: 'First write.',
    now: NOW,
    category: 'Personal Complete',
  }

  await writeStreak(input, { streaksDir, timeDir })

  let thrown: unknown
  try {
    await writeStreak({ ...input, title: 'Different title' }, { streaksDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({ actual: thrown instanceof SlugCollisionError, expected: true })
})

test('writeStreak does not overwrite a file created during category inference', async () => {
  await withDayNotebook(async ({ context }) => {
    const { config, notebookNow } = context
    const file = path.join(config.DIR_STREAKS, 'active/read.md')
    const other = StreakDocument.create({ name: 'read', title: 'Read outside' }).toMarkdown()
    let error: unknown
    try {
      await writeStreak(
        {
          name: 'read',
          title: 'Read a chapter',
          why: 'Develop skills for work.',
          schedule: 'daily',
          start: notebookNow.plainDateTime.plainDate,
          now: notebookNow,
        },
        {
          streaksDir: config.DIR_STREAKS,
          timeDir: config.DIR_TIME,
          classify: async () => {
            await outputFile(file, other)
            return 'Professional'
          },
        },
      )
    } catch (problem) {
      error = problem
    }
    assert({
      given: 'a competing creation while the classifier runs',
      should: 'reject the collision and leave the existing file intact',
      actual: [error instanceof SlugCollisionError, await readTextFile(file)],
      expected: [true, other],
    })
  })
})

test('writeStreak - refuses a title collision among active streaks', async () => {
  const streaksDir = await makeTempDir({ prefix: 'streaks-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'eat-clean',
    title: 'Eat clean',
    schedule: 'daily' as const,
    start: new PlainDate('2026-03-05'),
    why: 'First write.',
    now: NOW,
    category: 'Personal Complete',
  }

  await writeStreak(input, { streaksDir, timeDir })

  let thrown: unknown
  try {
    await writeStreak({ ...input, name: 'eat-clean-2' }, { streaksDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({
    given: 'a second streak with a different name but the same title',
    should: 'refuse — titles are the day-file join key',
    actual: thrown instanceof TitleCollisionError,
    expected: true,
  })
})
