import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildDayEnding } from './ending.ts'
import { createDayRoutes, type DayView } from './mod.ts'

const TUESDAY = new PlainDate('2030-09-24')
const WEDNESDAY = new PlainDate('2030-09-25')

const dayMarkdown = (day: PlainDate, frontmatter: string) => `---
${frontmatter}tz: America/Chicago
---

# **${day.ymd} - ${day.dayShort}**

## Professional Todos
- ~~Review the Q3 budget~~
- Write the offsite agenda
`

/** Tuesday's meetings and events: one ranged, two stating only their start. */
const TUESDAY_FILES: Record<string, string> = {
  'actions/events/27-00_Earnings-call.md': `---
what: Northwind earnings call
when: 2030-09-24 27:00
---

# Northwind earnings call

Quarterly results, read later.
`,
  'actions/meetings/16-30_Zoom_Sam-Lee_Design-review.md': `---
who: Sam Lee
when: 2030-09-24 16:30 - 17:30
---

# Design review

- The partner portal ships after the launch.
`,
  'actions/meetings/11-00_Zoom_Jane-Doe_Release-sync.md': `---
who: Jane Doe, Sam Lee
when: 2030-09-24 11:00
---

# Release sync

- The release moves to Thursday.
`,
}

async function notebook(): Promise<{ base: string; timeDir: string }> {
  const base = await makeTempDir({ prefix: 'sky-day-end-' })
  const timeDir = path.join(base, 'time')
  for (const [relative, content] of Object.entries(TUESDAY_FILES)) {
    const file = path.join(timeDir, dayDir(TUESDAY), relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return { base, timeDir }
}

test('ending - names the meetings and events that state no end time', async () => {
  const { base, timeDir } = await notebook()
  const ending = await buildDayEnding({ dayDirPath: path.join(timeDir, dayDir(TUESDAY)), markdownBaseDir: base })
  assert({
    given: 'a meeting stating only its start, one with a range, and an event stating only its start',
    should: 'name the two records with no end time, in start order',
    actual: ending.endless,
    expected: [
      {
        start: '11:00',
        title: 'Release sync',
        path: path.join('time', dayDir(TUESDAY), 'actions/meetings/11-00_Zoom_Jane-Doe_Release-sync.md'),
      },
      {
        start: '27:00',
        title: 'Northwind earnings call',
        path: path.join('time', dayDir(TUESDAY), 'actions/events/27-00_Earnings-call.md'),
      },
    ],
  })
})

test('end route - runs day:end when End is pressed and answers with the ended day', async () => {
  const { base, timeDir } = await notebook()
  const tuesday = path.join(timeDir, dayFile(TUESDAY))
  const wednesday = path.join(timeDir, dayFile(WEDNESDAY))
  await writeFile(tuesday, dayMarkdown(TUESDAY, 'started: 06:55\nended:\n'))
  await mkdir(path.dirname(wednesday), { recursive: true })
  await writeFile(wednesday, dayMarkdown(WEDNESDAY, ''))
  const calls: string[] = []
  let fail = true
  const options = { markdownBaseDir: base, timeDir, ownerNames: ['Jane Doe'], today: () => WEDNESDAY }
  const app = createDayRoutes({
    ...options,
    commands: {
      endDay: async (day: PlainDate) => {
        calls.push(day.ymd)
        if (fail) throw new Error('day:end did not finish')
        const file = path.join(timeDir, dayFile(day))
        await writeFile(file, (await readFile(file, 'utf8')).replace('ended:\n', 'ended: 15.5h\n'))
      },
    },
  })
  const bare = createDayRoutes(options)
  const post = (route: string) => app.request(route, { method: 'POST' })

  const failed = await post(`/${TUESDAY.ymd}/end`)
  const failedBody = (await failed.json()) as { error: string; view: DayView }
  fail = false
  const ended = await post(`/${TUESDAY.ymd}/end`)
  const endedView = (await ended.json()) as DayView
  const again = await post(`/${TUESDAY.ymd}/end`)
  const neverStarted = await post(`/${WEDNESDAY.ymd}/end`)
  const noHost = await bare.request(`/${TUESDAY.ymd}/end`, { method: 'POST' })

  assert({
    given: 'Tuesday open, a day:end that fails, then one that finishes, a second End, a day never started, and no host',
    should: 'run day:end once per press, report a failure, and refuse what cannot end',
    actual: {
      calls,
      statuses: [failed.status, ended.status, again.status, neverStarted.status, noHost.status],
      failure: failedBody.error,
      stillOpen: failedBody.view.record.ended,
      record: {
        started: endedView.record.started,
        ended: endedView.record.ended,
        endedClock: endedView.record.endedClock,
      },
    },
    expected: {
      calls: ['2030-09-24', '2030-09-24'],
      statuses: [422, 200, 409, 409, 404],
      failure: 'day:end did not finish',
      stillOpen: false,
      record: { started: '06:55', ended: true, endedClock: '22:25' },
    },
  })
})
