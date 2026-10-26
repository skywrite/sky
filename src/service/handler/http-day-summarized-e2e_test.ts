import { readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const FILE = path.posix.join('time', dayFile(DAY))
const BRIEF = path.posix.join('time', dayDir(DAY), 'brief.md')
const OPEN = `---
started: 08:00
ended:
tz: America/Chicago
---

# **2026-01-27 - Tue**

## Most Important

- Finish the launch brief

## Professional Commitments

- 16:00 > Send the proposal to Jane Doe

## Professional Todos

- Read [Atlas brief](brief.md)
- ~~Review the draft budget~~

## Reminders

- Leave space between meetings
`
const end = (markdown: string) => markdown.replace('ended:\n', 'ended: 13.5h\n')

test(
  { name: 'summary polling locks and reopens the record while manual Start remains available', timeout: 60000 },
  async (t) => {
    const starts: string[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: end(OPEN),
        tempPrefix: 'day-summary-cutoff-',
        file: FILE,
        day: true,
        now: new ZonedDateTime({ date: DAY.ymd, time: '31:00', timezone: 'America/Chicago' }),
        week: () => ({
          startDay: async (day) => {
            starts.push(day.ymd)
          },
        }),
      },
      async ({ page, origin, file, errors }) => {
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        const priority = page.locator('.sky-day-priority')
        await priority.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
        await writeFile(daySummaryPath(file), '# Summary\n\nAtlas planning moved forward.\n')
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await page.locator('.sky-day-summarized').waitFor()
        assert({
          given: 'a summary appears while the day record is open',
          should: 'freeze task controls without requiring navigation or changing the notebook day',
          actual: [await priority.getByRole('button', { name: 'Mark done', exact: true }).count(), starts],
          expected: [0, []],
        })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.getByRole('article', { name: 'Tuesday summary' }).waitFor()
        await page.getByRole('button', { name: 'Start Wednesday' }).waitFor()
        const summaryTitle = await page.title()
        await page.goto(`${origin}/week`)
        await page.getByText('Summarized', { exact: true }).waitFor()
        assert({
          given: 'the summary is shown by default and on the week page',
          should: 'identify the viewed summary, keep Start manual, and offer no End action',
          actual: [summaryTitle.includes('Summary'), await page.getByRole('button', { name: /^End / }).count(), starts],
          expected: [true, 0, []],
        })
        await page.goBack()
        await page.getByRole('article', { name: 'Tuesday summary' }).waitFor()
        await rm(daySummaryPath(file))
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await priority.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
        assert({
          given: 'the summary is removed while a legacy ended marker remains',
          should: 'return to the editable record and update its title without starting a day',
          actual: [
            await page.locator('.sky-day-summarized').count(),
            (await page.title()).includes('Day record'),
            starts,
          ],
          expected: [0, true, []],
        })
        await page.goto(`${origin}/week`)
        await page.getByRole('button', { name: 'Review Tuesday' }).waitFor()
        await page.getByRole('button', { name: 'Start Wednesday' }).click()
        assert({
          given: 'Start is explicitly pressed after the review cutoff changes',
          should: 'run Start once and leave the old day file untouched',
          actual: [starts, (await readFile(file, 'utf8')) === end(OPEN), errors],
          expected: [[DAY.addDays(1).ymd], true, []],
        })
      },
    )
  },
)

test(
  {
    name: 'summarized day keeps readable tasks and document links without editing controls on desktop and mobile',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: end(OPEN),
        tempPrefix: 'day-summarized-',
        file: FILE,
        files: {
          [BRIEF]: '# Atlas brief\n\nA sample launch plan to review with the team.\n',
          [daySummaryPath(FILE)]: '# Summary\n',
        },
        day: true,
      },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        const badge = page.locator('.sky-day-summarized')
        await badge.waitFor()
        await badge.focus()
        await page.getByRole('tooltip').waitFor()
        assert({
          given: 'an summarized day with both finished and unfinished tasks',
          should: 'show the Summarized label, and a readable explanation',
          actual: {
            label: await badge.innerText(),
            icons: await badge.locator('svg').count(),
            explanation: await page.getByRole('tooltip').innerText(),
            count: await page.locator('.sky-day-progress').innerText(),
          },
          expected: {
            label: 'Summarized',
            icons: 0,
            explanation: 'This day has a saved summary. Remove its summary to edit tasks again.',
            count: 'Summarized\n·\n1 of 4 tasks complete',
          },
        })
        // Close the badge's tooltip: left open, it trails the resize below by a frame and reads as overflow.
        await badge.blur()
        await page.getByRole('tooltip').waitFor({ state: 'hidden' })

        for (const width of [1500, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await page
            .locator('.sky-irow-front')
            .first()
            .evaluate((row) => {
              for (const [type, x] of [
                ['touchstart', 300],
                ['touchmove', 20],
                ['touchend', 20],
              ] as const) {
                const finger = new Touch({ identifier: 1, target: row, clientX: x, clientY: 20 })
                row.dispatchEvent(
                  new TouchEvent(type, {
                    bubbles: true,
                    touches: type === 'touchend' ? [] : [finger],
                    changedTouches: [finger],
                  }),
                )
              }
            })
          const selected = await page
            .locator('.sky-irow-front .sky-ptext')
            .first()
            .evaluate((text) => {
              const range = document.createRange()
              range.selectNodeContents(text)
              const selection = document.getSelection()
              selection?.removeAllRanges()
              selection?.addRange(range)
              return selection?.toString()
            })
          assert({
            given: `an summarized day at ${width}px with a swipe attempted on a task`,
            should: 'keep task text selectable, preserve the file, and offer no task mutations or extra record heading',
            actual: {
              buttons: await page.locator('.sky-prow button').count(),
              undo: await page.getByRole('button', { name: 'Undo', exact: true }).count(),
              swipeDelete: await page.locator('.sky-irow-delete').count(),
              extraHeading: await page.getByText('The day so far', { exact: true }).count(),
              selected,
              unchanged: (await readFile(file, 'utf8')) === end(OPEN),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            },
            expected: {
              buttons: 0,
              undo: 0,
              swipeDelete: 0,
              extraHeading: 0,
              selected: 'Finish the launch brief',
              unchanged: true,
              overflow: false,
            },
          })
        }
        await page.getByRole('link', { name: 'Read Atlas brief', exact: true }).click()
        await page.waitForURL(`**/explorer/${BRIEF}`)
        await writeFile(file, end(OPEN.split('\n## Most Important')[0]))
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        await badge.waitFor()
        assert({
          given: 'a day whose lists have been cleared after summarizing',
          should: 'keep the Summarized indicator even without a task count and produce no browser errors',
          actual: { progress: await page.locator('.sky-day-progress').innerText(), errors },
          expected: { progress: 'Summarized', errors: [] },
        })
      },
    )
  },
)

test(
  { name: 'a stale day view refreshes to Summarized when a completion or Undo is refused', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: OPEN, tempPrefix: 'day-summarized-stale-', file: FILE, day: true },
      async ({ page, origin, file, errors }) => {
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        const priority = page.locator('.sky-day-priority')
        await priority.getByRole('button', { name: 'Mark done', exact: true }).click()
        const undo = page.getByRole('button', { name: 'Undo', exact: true })
        await undo.waitFor()
        const endedAfterCompletion = end(await readFile(file, 'utf8'))
        await writeFile(file, endedAfterCompletion)
        await writeFile(daySummaryPath(file), '# Summary\n')
        const undoResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/day/${DAY.ymd}/item/row/undo`) && response.request().method() === 'POST',
        )
        await undo.click()
        await page.locator('.sky-day-summarized').waitFor()
        assert({
          given: 'the day is summarized while a completed task has an Undo available in an old tab',
          should: 'refuse Undo and replace all task controls with the summarized state',
          actual: {
            status: (await undoResponse).status(),
            unchanged: (await readFile(file, 'utf8')) === endedAfterCompletion,
            controls: await page.locator('.sky-prow button, .sky-undo-btn').count(),
          },
          expected: { status: 409, unchanged: true, controls: 0 },
        })

        await writeFile(file, OPEN)
        await rm(daySummaryPath(file))
        await page.reload()
        await priority.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
        await writeFile(file, end(OPEN))
        await writeFile(daySummaryPath(file), '# Summary\n')
        const completionResponse = page.waitForResponse(
          (response) => response.url().endsWith(`/day/${DAY.ymd}/item`) && response.request().method() === 'POST',
        )
        await priority.getByRole('button', { name: 'Mark done', exact: true }).click()
        await page.locator('.sky-day-summarized').waitFor()
        await priority.getByRole('img', { name: 'Incomplete', exact: true }).waitFor()
        // Chromium reports the expected rejected writes as resource errors in its console.
        const conflict = 'console: Failed to load resource: the server responded with a status of 409 (Conflict)'
        for (let i = errors.length - 1; i >= 0; i--) if (errors[i] === conflict) errors.splice(i, 1)
        assert({
          given: 'a checkbox pressed in a stale tab after the summary was saved elsewhere',
          should: 'restore the unfinished task without writing and show Summarized',
          actual: {
            status: (await completionResponse).status(),
            unchanged: (await readFile(file, 'utf8')) === end(OPEN),
            controls: await page.locator('.sky-prow button, .sky-undo-btn').count(),
            errors,
          },
          expected: { status: 409, unchanged: true, controls: 0, errors: [] },
        })
      },
    )
  },
)
