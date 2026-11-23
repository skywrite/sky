import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { planSection } from './listBlocks.ts'
import { rolloverReminders, type ReminderRolloverConfig } from './reminderRollover.ts'

async function withNotebook(
  run: (nb: {
    root: string
    config: ReminderRolloverConfig
    writeDay: (ymd: string, body: string) => Promise<string>
    readDay: (ymd: string) => Promise<string>
    remindersOf: (ymd: string) => Promise<string[]>
  }) => Promise<void>,
) {
  const root = await makeTempDir({ prefix: 'sky-reminder-rollover-' })
  const config: ReminderRolloverConfig = {
    DIR_BASE: root,
    DIR_TIME: path.join(root, 'time'),
    DIR_STATE: path.join(root, '.state'),
    FILE_REMINDERS: path.join(root, 'time', 'reminders.md'),
  }
  const fileOf = (ymd: string) => path.join(config.DIR_TIME, dayFile(ymd))
  const writeDay = async (ymd: string, body: string) => {
    const file = fileOf(ymd)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body, 'utf8')
    return file
  }
  const readDay = (ymd: string) => readFile(fileOf(ymd), 'utf8')
  const remindersOf = async (ymd: string) =>
    (planSection(await readDay(ymd), 'Reminders')?.rows ?? []).map((row) => row.raw).filter(Boolean)
  try {
    await run({ root, config, writeDay, readDay, remindersOf })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('rollover moves unfinished reminders to today, dedupes copies, skips summarized days, and is idempotent', async () => {
  await withNotebook(async ({ config, writeDay, readDay, remindersOf }) => {
    const summarized = await writeDay('2031-04-08', '## Reminders\n\n- Keep on closed day\n')
    await writeFile(daySummaryPath(summarized), '# Summary\n', 'utf8')
    await writeDay(
      '2031-04-09',
      '## Reminders\n\n- Water the plants\n- Check [Atlas notes](actions/notes/atlas.md)\n- Water the plants\n',
    )
    await writeDay('2031-04-10', '## Reminders\n\n- Water the plants\n- Call Jane Doe\n')
    await writeDay('2031-04-11', '## Reminders\n\n- Call Jane Doe\n')

    const first = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-11'),
      autoRollover: true,
      expireDays: 3,
    })
    const second = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-11'),
      autoRollover: true,
      expireDays: 3,
    })

    assert({
      given: 'one summarized day and two unclosed past days with duplicate and relative-linked reminders',
      should: 'skip the closed day, move unique reminders once, rebase links, clear sources, and repeat cleanly',
      actual: {
        first,
        second,
        closedDay: await remindersOf('2031-04-08'),
        day09: await remindersOf('2031-04-09'),
        day10: await remindersOf('2031-04-10'),
        today: await remindersOf('2031-04-11'),
        day09HasPlaceholder: (await readDay('2031-04-09')).includes('## Reminders\n\n-'),
      },
      expected: {
        first: { moved: 2, expired: 0, deduped: 3, daysCleared: ['2031-04-09', '2031-04-10'] },
        second: { moved: 0, expired: 0, deduped: 0, daysCleared: [] },
        closedDay: ['Keep on closed day'],
        day09: [],
        day10: [],
        today: ['Call Jane Doe', 'Water the plants', 'Check [Atlas notes](../04-09/actions/notes/atlas.md)'],
        day09HasPlaceholder: true,
      },
    })
  })
})

test('reminders expire after 3 days untouched and start fresh if re-added later', async () => {
  await withNotebook(async ({ config, writeDay, remindersOf }) => {
    await writeDay('2031-04-10', '## Reminders\n\n- Renew passport\n')
    await writeDay('2031-04-11', '## Reminders\n\n-\n')
    await writeDay('2031-04-12', '## Reminders\n\n-\n')
    await writeDay('2031-04-13', '## Reminders\n\n-\n')

    // Day 2 (age 1): rolls forward
    const day2 = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-11'),
      autoRollover: true,
      expireDays: 3,
    })
    // Day 3 (age 2): rolls forward
    const day3 = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-12'),
      autoRollover: true,
      expireDays: 3,
    })
    // Day 4 (age 3 >= 3): expires and leaves day 3 clean
    const day4 = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-13'),
      autoRollover: true,
      expireDays: 3,
    })

    // Re-adding the same text later starts a fresh 3-day clock
    await writeDay('2031-04-14', '## Reminders\n\n- Renew passport\n')
    await writeDay('2031-04-15', '## Reminders\n\n-\n')
    const readded = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-15'),
      autoRollover: true,
      expireDays: 3,
    })

    assert({
      given: 'one reminder left untouched across four mornings, then re-added later',
      should: 'roll on days 2 and 3, expire on day 4, and roll fresh when added again',
      actual: {
        moves: [day2.moved, day3.moved, day4.moved, day4.expired, readded.moved, readded.expired],
        day12: await remindersOf('2031-04-12'),
        day13: await remindersOf('2031-04-13'),
        day15: await remindersOf('2031-04-15'),
      },
      expected: {
        moves: [1, 1, 0, 1, 1, 0],
        day12: [],
        day13: [],
        day15: ['Renew passport'],
      },
    })
  })
})

test('recurring reminders from reminders.md expire after 1 day while ad-hoc ones live expireDays', async () => {
  await withNotebook(async ({ config, writeDay, remindersOf }) => {
    await mkdir(path.dirname(config.FILE_REMINDERS!), { recursive: true })
    await writeFile(
      config.FILE_REMINDERS!,
      '## EVERY-DAY\n- Clean whiteboard\n\n## Saturday\n- Weekly review\n',
      'utf8',
    )
    await writeDay('2031-04-12', '## Reminders\n\n- Clean whiteboard\n- Weekly review\n- Send Jane the outline\n')
    await writeDay('2031-04-13', '## Reminders\n\n-\n')

    const result = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-13'),
      autoRollover: true,
      expireDays: 3,
    })

    assert({
      given: 'daily recurring, weekly recurring, and ad-hoc reminders from yesterday',
      should: 'expire both recurring reminders after 1 day and roll the ad-hoc one to today',
      actual: {
        result,
        yesterday: await remindersOf('2031-04-12'),
        today: await remindersOf('2031-04-13'),
      },
      expected: {
        result: { moved: 1, expired: 2, deduped: 0, daysCleared: ['2031-04-12'] },
        yesterday: [],
        today: ['Send Jane the outline'],
      },
    })
  })
})

test('expireDays 0 keeps all reminders indefinitely and autoRollover false leaves past days alone', async () => {
  await withNotebook(async ({ config, writeDay, remindersOf }) => {
    await writeDay('2031-04-05', '## Reminders\n\n- Old item\n')
    await writeDay('2031-04-12', '## Reminders\n\n-\n')

    const disabled = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-12'),
      autoRollover: false,
      expireDays: 3,
    })
    const stillOnOld = await remindersOf('2031-04-05')

    const noExpiry = await rolloverReminders({
      config,
      targetDay: new PlainDate('2031-04-12'),
      autoRollover: true,
      expireDays: 0,
    })

    assert({
      given: 'autoRollover off, then on with expireDays 0 on a 7-day-old reminder',
      should: 'leave past days untouched when off, and roll without expiring when expireDays is 0',
      actual: {
        disabled,
        stillOnOld,
        noExpiry,
        today: await remindersOf('2031-04-12'),
      },
      expected: {
        disabled: { moved: 0, expired: 0, deduped: 0, daysCleared: [] },
        stillOnOld: ['Old item'],
        noExpiry: { moved: 1, expired: 0, deduped: 0, daysCleared: ['2031-04-05'] },
        today: ['Old item'],
      },
    })
  })
})
