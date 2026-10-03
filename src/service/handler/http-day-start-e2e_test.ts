// Run with `bun test service/handler/http-day-start-e2e_test.ts` (a real browser).
import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

// Thursday is the day left open past midnight; Friday's plan waits in a file that never started.
const THURSDAY = new PlainDate('2030-09-26')
const FRIDAY = new PlainDate('2030-09-27')
const TZ = 'America/Chicago'
const at = (time: string, day: PlainDate) => new ZonedDateTime(new PlainDateTime(time, day.ymd), TZ)
const THURSDAY_FILE = path.posix.join('time', dayFile(THURSDAY))
const FRIDAY_FILE = path.posix.join('time', dayFile(FRIDAY))

const THURSDAY_OPEN = `---
started: 07:12
ended:
tz: ${TZ}
---

# **2030-09-26 - Thu**

## Professional Todos
- ~~Send the pricing memo to Jane Doe~~
- Draft the Q4 hiring plan
`

const FRIDAY_PREPARED = `---
tz: ${TZ}
---

# **2030-09-27 - Fri**

## Professional Commitments
- 10:00 > Board prep with Sam Lee

## Professional Todos
- Send the offsite agenda to the team
`

test(
  { name: 'the waiting day: a whisper at night, a block in the morning, and Start on its own page', timeout: 60000 },
  async (t) => {
    const starts: string[] = []
    const options = {
      initialMarkdown: THURSDAY_OPEN,
      tempPrefix: 'day-start-',
      file: THURSDAY_FILE,
      files: { [FRIDAY_FILE]: FRIDAY_PREPARED },
      day: true,
      now: at('24:40', THURSDAY),
      // day:start's own stamp over the temp notebook; the notebook clock moves with it
      week: (base: string) => ({
        startDay: async (day: PlainDate) => {
          starts.push(day.ymd)
          const file = path.join(base, 'time', dayFile(day))
          await writeFile(file, (await readFile(file, 'utf8')).replace('---\ntz:', '---\nstarted: 07:06\nended:\ntz:'))
          options.now = at('07:10', FRIDAY)
        },
        endDay: async () => {},
      }),
    }
    await runWysiwygE2e(t, options, async ({ page, origin, errors }) => {
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      await page.setViewportSize({ width: 1440, height: 1000 })

      // 00:40, still up: Thursday's page whispers under its count, and End is already there.
      await page.goto(`${origin}/`)
      const whisper = page.locator('.sky-day-statusline[data-start="night"]')
      await whisper.waitFor()
      const night = {
        line: await whisper.innerText(),
        block: await page.locator('.sky-day-start').count(),
        endButtons: await page.getByRole('button', { name: 'End Thursday' }).count(),
      }

      // 07:05, back: the block at the top of Thursday's page, and no whisper.
      options.now = at('31:05', THURSDAY)
      await page.goto(`${origin}/`)
      await page.locator('.sky-day-start').waitFor()
      const morning = {
        lead: await page.locator('.sky-day-start-lead').innerText(),
        sub: await page.locator('.sky-day-start-sub').innerText(),
        whisper: await whisper.count(),
        dot: await page.locator('.sky-side .sky-wdot').count(),
      }

      // The week page still offers Start, quietly.
      await page.goto(`${origin}/week`)
      const weekStart = page.getByRole('button', { name: 'Start Friday' })
      await weekStart.waitFor()
      const weekVariant = await weekStart.getAttribute('data-variant')

      // Friday's own page: Not started, its count, and Start beside them. Pressing it runs day:start.
      await page.goto(`${origin}/${FRIDAY.ymd}`)
      await page.getByRole('button', { name: 'Start Friday' }).waitFor()
      const own = await page.locator('.sky-day-statusline').innerText()
      await page.getByRole('button', { name: 'Start Friday' }).click()
      await page.locator('.sky-title', { hasText: 'Friday, September 27, 2030' }).waitFor()
      await page.locator('.sky-side .sky-wdot').waitFor({ state: 'detached' })
      const after = {
        path: new URL(page.url()).pathname,
        statusline: await page.locator('.sky-day-statusline').innerText(),
        startButtons: await page.getByRole('button', { name: 'Start Friday' }).count(),
        block: await page.locator('.sky-day-start').count(),
      }

      assert({
        given: 'Thursday open at 00:40, then 07:05, Friday prepared but not started, and Start pressed on its page',
        should: 'whisper at night, carry the block in the morning, start Friday once, and land on it as today',
        actual: { night, morning, weekVariant, own, starts, after, errors },
        expected: {
          night: {
            line: 'Past midnight. Still Thursday until you start Friday\n·\nStart Friday',
            block: 0,
            endButtons: 1,
          },
          morning: {
            lead: 'It’s Friday, September 27.',
            sub: 'You’re still on Thursday. Anything you add goes there until you start Friday.',
            whisper: 0,
            dot: 1,
          },
          weekVariant: 'secondary',
          own: 'Not started\n·\n0 of 2 tasks complete\n·\nStart Friday',
          starts: [FRIDAY.ymd],
          after: { path: '/', statusline: '0 of 2 tasks complete', startButtons: 0, block: 0 },
          errors: [],
        },
      })
    })
  },
)
