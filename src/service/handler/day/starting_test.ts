import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes, type DayView } from './mod.ts'

const THURSDAY = new PlainDate('2030-09-26')
const FRIDAY = new PlainDate('2030-09-27')
const SATURDAY = new PlainDate('2030-09-28')
const TZ = 'America/Chicago'

/** The notebook clock at `HH:MM` on the day it is still on — hours past 24 for a day left open. */
const clockAt = (time: string, day: PlainDate) => () => new ZonedDateTime(new PlainDateTime(time, day.ymd), TZ)

const dayMarkdown = (day: PlainDate, frontmatter: string) => `---
${frontmatter}tz: ${TZ}
---

# **${day.ymd} - ${day.dayShort}**

## Professional Todos
- Write the offsite agenda
`

async function notebook(): Promise<{ base: string; timeDir: string }> {
  const base = await makeTempDir({ prefix: 'sky-day-start-' })
  const timeDir = path.join(base, 'time')
  const thursday = path.join(timeDir, dayFile(THURSDAY))
  await mkdir(path.dirname(thursday), { recursive: true })
  await writeFile(thursday, dayMarkdown(THURSDAY, 'started: 07:12\nended:\n'))
  return { base, timeDir }
}

test('day view - names the day waiting to start once the clock has run past midnight', async () => {
  const { base, timeDir } = await notebook()
  const view = async (now: () => ZonedDateTime, ymd?: string) => {
    const response = await createDayRoutes({ markdownBaseDir: base, timeDir, now }).request(ymd ? `/${ymd}` : '/')
    const body = (await response.json()) as DayView
    return { today: body.today.ymd, due: body.due }
  }

  assert({
    given: 'Thursday started at 07:12 and never ended, read at 22:41, 24:40, 31:05 and two nights on at 52:30',
    should: 'show no waiting day while the clocks agree, then name Friday — a night before 04:00, a morning after',
    actual: {
      evening: await view(clockAt('22:41', THURSDAY)),
      night: await view(clockAt('24:40', THURSDAY)),
      morning: await view(clockAt('31:05', THURSDAY)),
      twoNights: await view(clockAt('52:30', THURSDAY)),
      fridaysPage: (await view(clockAt('31:05', THURSDAY), FRIDAY.ymd)).due?.ymd,
    },
    expected: {
      evening: { today: THURSDAY.ymd, due: null },
      night: {
        today: THURSDAY.ymd,
        due: { ymd: FRIDAY.ymd, weekday: 'Friday', dateLabel: 'Friday, September 27, 2030', night: true },
      },
      morning: {
        today: THURSDAY.ymd,
        due: { ymd: FRIDAY.ymd, weekday: 'Friday', dateLabel: 'Friday, September 27, 2030', night: false },
      },
      twoNights: {
        today: THURSDAY.ymd,
        due: { ymd: SATURDAY.ymd, weekday: 'Saturday', dateLabel: 'Saturday, September 28, 2030', night: false },
      },
      fridaysPage: FRIDAY.ymd,
    },
  })
})

test('start route - runs day:start when Start is pressed and answers with the started day', async () => {
  const { base, timeDir } = await notebook()
  const calls: string[] = []
  let fail = true
  const options = { markdownBaseDir: base, timeDir, now: clockAt('31:05', THURSDAY) }
  const app = createDayRoutes({
    ...options,
    commands: {
      startDay: async (day: PlainDate) => {
        calls.push(day.ymd)
        if (fail) throw new Error('day:start did not finish')
        const file = path.join(timeDir, dayFile(day))
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, dayMarkdown(day, 'started: 07:06\nended:\n'))
      },
      endDay: async () => {},
    },
  })
  const bare = createDayRoutes(options)
  const post = (route: string) => app.request(route, { method: 'POST' })

  const failed = await post(`/${FRIDAY.ymd}/start`)
  const failedBody = (await failed.json()) as { error: string; view: DayView }
  fail = false
  const started = await post(`/${FRIDAY.ymd}/start`)
  const startedView = (await started.json()) as DayView
  const again = await post(`/${FRIDAY.ymd}/start`)
  const tooSoon = await post(`/${SATURDAY.ymd}/start`)
  const tooSoonBody = (await tooSoon.json()) as { error: string }
  const noHost = await bare.request(`/${FRIDAY.ymd}/start`, { method: 'POST' })
  const written = await readFile(path.join(timeDir, dayFile(FRIDAY)), 'utf8')

  assert({
    given: 'Friday waiting, a day:start that fails, then one that finishes, a second Start, Saturday, and no host',
    should: 'run day:start once per press, report a failure, and refuse what cannot start',
    actual: {
      calls,
      statuses: [failed.status, started.status, again.status, tooSoon.status, noHost.status],
      failure: failedBody.error,
      stillWaiting: failedBody.view.record.started,
      started: startedView.record.started,
      tooSoon: tooSoonBody.error,
      stamped: written.includes('started: 07:06'),
    },
    expected: {
      calls: [FRIDAY.ymd, FRIDAY.ymd],
      statuses: [422, 200, 409, 409, 404],
      failure: 'day:start did not finish',
      stillWaiting: null,
      started: '07:06',
      tooSoon: 'Saturday has not come yet.',
      stamped: true,
    },
  })
})
