import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
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
  {
    name: 'ended day keeps readable tasks and document links without editing controls on desktop and mobile',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: end(OPEN),
        tempPrefix: 'day-ended-',
        file: FILE,
        files: { [BRIEF]: '# Atlas brief\n\nA sample launch plan to review with the team.\n' },
        day: true,
      },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        const badge = page.locator('.sky-day-ended')
        await badge.waitFor()
        await badge.focus()
        await page.getByRole('tooltip').waitFor()
        assert({
          given: 'an ended day with both finished and unfinished tasks',
          should: 'show the padlock, the Ended label with its time, and a readable explanation',
          actual: {
            label: await badge.innerText(),
            icons: await badge.locator('svg').count(),
            explanation: await page.getByRole('tooltip').innerText(),
            count: await page.locator('.sky-day-progress').innerText(),
          },
          expected: {
            label: 'Ended 21:30',
            icons: 1,
            explanation: 'Ended at 21:30. Tasks are read-only.',
            count: 'Ended 21:30\n·\n1 of 4 tasks complete',
          },
        })

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
            given: `an ended day at ${width}px with a swipe attempted on a task`,
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
        await page.goto(`${origin}/${DAY.ymd}`)
        await badge.waitFor()
        assert({
          given: 'a day whose lists have been cleared after ending',
          should: 'keep the Ended indicator even without a task count and produce no browser errors',
          actual: { progress: await page.locator('.sky-day-progress').innerText(), errors },
          expected: { progress: 'Ended 21:30', errors: [] },
        })
      },
    )
  },
)

test(
  { name: 'a stale day view refreshes to Ended when a completion or Undo is refused', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: OPEN, tempPrefix: 'day-ended-stale-', file: FILE, day: true },
      async ({ page, origin, file, errors }) => {
        await page.goto(`${origin}/${DAY.ymd}`)
        const priority = page.locator('.sky-day-priority')
        await priority.getByRole('button', { name: 'Mark done', exact: true }).click()
        const undo = page.getByRole('button', { name: 'Undo', exact: true })
        await undo.waitFor()
        const endedAfterCompletion = end(await readFile(file, 'utf8'))
        await writeFile(file, endedAfterCompletion)
        const undoResponse = page.waitForResponse(
          (response) => response.url().endsWith(`/day/${DAY.ymd}/item`) && response.request().method() === 'POST',
        )
        await undo.click()
        await page.locator('.sky-day-ended').waitFor()
        assert({
          given: 'the day ends while a completed task has an Undo available in an old tab',
          should: 'refuse Undo and replace all task controls with the ended state',
          actual: {
            status: (await undoResponse).status(),
            unchanged: (await readFile(file, 'utf8')) === endedAfterCompletion,
            controls: await page.locator('.sky-prow button, .sky-undo-btn').count(),
          },
          expected: { status: 409, unchanged: true, controls: 0 },
        })

        await writeFile(file, OPEN)
        await page.reload()
        await priority.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
        await writeFile(file, end(OPEN))
        const completionResponse = page.waitForResponse(
          (response) => response.url().endsWith(`/day/${DAY.ymd}/item`) && response.request().method() === 'POST',
        )
        await priority.getByRole('button', { name: 'Mark done', exact: true }).click()
        await page.locator('.sky-day-ended').waitFor()
        await priority.getByRole('img', { name: 'Incomplete', exact: true }).waitFor()
        // Chromium reports the expected rejected writes as resource errors in its console.
        const conflict = 'console: Failed to load resource: the server responded with a status of 409 (Conflict)'
        for (let i = errors.length - 1; i >= 0; i--) if (errors[i] === conflict) errors.splice(i, 1)
        assert({
          given: 'a checkbox pressed in a stale tab after the day ended elsewhere',
          should: 'restore the unfinished task without writing and show Ended',
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
