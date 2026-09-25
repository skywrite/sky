import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

// Wednesday is the day under way at 22:41; Tuesday started and was never ended.
const TUESDAY = new PlainDate('2030-09-24')
const WEDNESDAY = new PlainDate('2030-09-25')
const NOW = new ZonedDateTime(new PlainDateTime('22:41', WEDNESDAY.ymd), 'America/Chicago')
const WEDNESDAY_FILE = path.posix.join('time', dayFile(WEDNESDAY))
const TUESDAY_FILE = path.posix.join('time', dayFile(TUESDAY))

const WEDNESDAY_OPEN = `---
started: 07:12
ended:
tz: America/Chicago
---

# **2030-09-25 - Wed**

## Professional Todos
- ~~Send the pricing memo to Jane Doe~~
- Draft the Q4 hiring plan
`

const TUESDAY_OPEN = `---
started: 06:55
ended:
tz: America/Chicago
---

# **2030-09-24 - Tue**

## Most Important
- ~~Ship the Atlas launch checklist~~

## Professional Commitments
- 09:30 > ~~Standup with the Atlas team~~
- 14:00 > Interview for the design lead role

## Professional Todos
- ~~Review the Q3 budget~~
- Write the offsite agenda

## Personal Todos
- Call the insurance company
`

const FILES = {
  [TUESDAY_FILE]: TUESDAY_OPEN,
  [path.posix.join('time', dayDir(TUESDAY), 'actions/meetings/11-00_Zoom_Jane-Doe_Release-sync.md')]: `---
who: Jane Doe, Sam Lee
when: 2030-09-24 11:00
---

# Release sync

- The release moves to Thursday.
`,
}

/** The calendar as the rail reads it: a past meeting with no notes filed. */
const CALENDAR = {
  read: true,
  errors: [],
  meetings: [
    {
      title: 'Design review',
      start: '16:30',
      end: '17:00',
      allDay: false,
      who: ['Sam Lee'],
      joinUrl: null,
      state: 'past',
      record: null,
    },
  ],
}

test(
  { name: 'ending a day waits for the calendar to move past it, asks first, and ends when pressed', timeout: 60000 },
  async (t) => {
    const ends: string[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: WEDNESDAY_OPEN,
        tempPrefix: 'day-end-',
        file: WEDNESDAY_FILE,
        files: FILES,
        day: true,
        now: NOW,
        // day:end's own stamp over the temp notebook: the moment End is pressed
        week: (base) => ({
          startDay: async () => {},
          endDay: async (day: PlainDate) => {
            ends.push(day.ymd)
            const file = path.join(base, 'time', dayFile(day))
            const doc = DayDocument.fromMarkdown(await readFile(file, 'utf8'))
            await writeFile(file, doc.setEnded(NOW).toMarkdown())
          },
        }),
      },
      async ({ page, origin, file, errors }) => {
        await page.route('**/day/*/schedule', (route) => route.fulfill({ json: CALENDAR }))
        await page.setViewportSize({ width: 1440, height: 1000 })

        // The day under way: the system clock and the notebook clock still agree on Wednesday.
        await page.goto(`${origin}/`)
        await page.locator('.sky-day-statusline').waitFor()
        const underWay = {
          statusline: await page.locator('.sky-day-statusline').innerText(),
          endButtons: await page.getByRole('button', { name: /^End / }).count(),
        }

        // Tuesday: the calendar moved past it, so it says so and offers End.
        const tuesdayFile = path.join(file, '..', '..', '09-24', 'day.md')
        await page.goto(`${origin}/${TUESDAY.ymd}`)
        await page.getByText('Not ended').waitFor()
        const statusline = await page.locator('.sky-day-statusline').innerText()
        await page.getByRole('button', { name: 'End Tuesday' }).click()

        const dialog = page.locator('.sky-end')
        await dialog.getByText('Release sync at 11:00 has no end time.').waitFor()
        await dialog.getByText('Design review at 16:30 is on your calendar but has no notes.').waitFor()
        const opened = {
          title: await dialog.locator('.sky-confirm-title').innerText(),
          open: await dialog.locator('.sky-end-row .sky-ptext').allInnerTexts(),
        }

        await dialog.getByRole('button', { name: 'Mark done: Write the offsite agenda' }).click()
        await dialog.getByRole('button', { name: 'Mark not done: Write the offsite agenda' }).waitFor()
        const ticked = (await readFile(tuesdayFile, 'utf8')).includes('- ~~Write the offsite agenda~~')

        await dialog.getByRole('button', { name: 'End Tuesday' }).click()
        await page.locator('.sky-day-ended').waitFor()
        assert({
          given: 'Wednesday under way at 22:41, and Tuesday never ended with open items and two meeting gaps',
          should: 'offer no End on Wednesday; ask first on Tuesday, tick in place, and end it when pressed',
          actual: {
            underWay,
            statusline,
            opened,
            ticked,
            ends,
            badge: await page.locator('.sky-day-ended').innerText(),
            dialogGone: await dialog.count(),
          },
          expected: {
            underWay: { statusline: '1 of 2 tasks complete', endButtons: 0 },
            statusline: 'Not ended\n·\n3 of 6 tasks complete\n·\nEnd Tuesday',
            opened: {
              title: 'End Tuesday?',
              open: ['Interview for the design lead role', 'Write the offsite agenda', 'Call the insurance company'],
            },
            ticked: true,
            ends: ['2030-09-24'],
            badge: 'Ended Sep 25, 22:41',
            dialogGone: 0,
          },
        })

        // The phone gets the same dialog as a sheet; the week page opens it too.
        await writeFile(tuesdayFile, TUESDAY_OPEN)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`${origin}/${TUESDAY.ymd}`)
        await page.getByRole('button', { name: 'End Tuesday' }).click()
        await page.locator('.sky-dialog-sheet .sky-end').waitFor()
        const phone = await page.evaluate(() => document.documentElement.scrollWidth)
        await page.getByRole('button', { name: 'Not yet' }).click()

        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.goto(`${origin}/week`)
        await page.getByRole('button', { name: 'End Tuesday' }).click()
        const fromWeek = await page.locator('.sky-end .sky-confirm-title').innerText()
        assert({
          given: 'a phone, then the week page',
          should: 'show the dialog as a sheet without sideways scroll, and open it from the week',
          actual: { phoneScroll: phone <= 390, fromWeek, errors },
          expected: { phoneScroll: true, fromWeek: 'End Tuesday?', errors: [] },
        })
      },
    )
  },
)
