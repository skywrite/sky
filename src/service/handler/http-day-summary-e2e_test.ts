import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2025-04-07')
const SUMMARY = `---
title: Daily Summary
---

# Daily Summary

## Day at a Glance

### The Atlas pilot got a start date

You and Jane agreed to begin with one team and a smaller release. The first customer signed the proposal that afternoon. [meeting 10:15](<actions/meetings/10-15_Atlas Planning.md>)

The evening belonged to the pottery studio, where the bowl you had been working on was ready to take home. [journal](<journal/evening.md>)

## Meaningful Moments

### A smaller release made the start possible

**When:** 10:15

You chose the two features the first team needs and moved everything else to a later release. Jane could commit to a start date with that scope. [meeting 10:15](<actions/meetings/10-15_Atlas Planning.md>)

### The first customer said yes

**When:** 14:00

The signed proposal arrived after lunch. The pilot starts on Monday, with a weekly conversation about what the team learns. [email 14:00](<actions/messages/14-00_Pilot approval.md>)

### A finished bowl came home

**When:** 18:30

At the studio, you picked up the bowl from the kiln and saw its blue glaze for the first time. You wrote that you wanted to make another. [journal](<journal/evening.md>)

## Done

- Agreed the pilot scope.
- Filed the signed proposal.

<!-- SUMMARY-CONTEXT hidden record -->
`

const DAY_RECORD = `---
started: 08:00
ended: 12h
tz: UTC
---

## Professional Todos

- ~~Prepare the Atlas checklist~~
`

test(
  {
    name: 'day summaries open by default, preserve selection, follow file changes, and keep the record accessible',
    timeout: 90000,
  },
  async (t) => {
    const dir = `time/${dayDir(DAY)}`
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: DAY_RECORD,
        tempPrefix: 'sky-day-summary-browser-',
        file: `time/${dayFile(DAY)}`,
        files: {
          [`${dir}/summary.md`]: SUMMARY,
          [`${dir}/actions/meetings/10-15_Atlas Planning.md`]:
            '# Atlas planning\n\nA smaller release for the first team.',
          [`${dir}/actions/messages/14-00_Pilot approval.md`]: '# Pilot approval\n\nThe pilot can begin.',
          [`${dir}/journal/evening.md`]: '# Evening\n\nThe blue bowl came home.',
          [`time/${dayFile(DAY.addDays(1))}`]: '## Professional Todos\n\n- Plan the next workshop',
          [`time/${dayDir(DAY.addDays(-1))}/summary.md`]:
            '## Day at a Glance\n\nAn afternoon in the garden.\n\n## Done\n\n- Planted herbs.',
        },
        day: true,
        now: new ZonedDateTime('2025-04-08T10:00:00', 'UTC'),
      },
      async ({ page, origin, file, errors }) => {
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        page.on('response', (response) => {
          if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`)
        })
        const summaryFile = path.join(path.dirname(file), 'summary.md')
        const summaryTitle = 'sky · Monday, April 7, 2025 · Summary'
        const recordTitle = 'sky · Monday, April 7, 2025 · Day record'
        const waitForTitle = (title: string) => page.waitForFunction((title) => document.title === title, title)
        await page.setViewportSize({ width: 1500, height: 1100 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.getByRole('heading', { name: 'The Atlas pilot got a start date', exact: true }).waitFor()
        await waitForTitle(summaryTitle)
        assert({
          given: 'a day with a saved summary',
          should: 'open the story and three authored moments, with source and full-file links',
          actual: {
            title: await page.title(),
            moments: await page.locator('.sky-summary-moment').count(),
            record: await page.locator('.sky-day .sky-col').count(),
            rail: await page.locator('.sky-day-rail').count(),
            source: await page.locator('.sky-summary-sources a').first().getAttribute('href'),
            full: await page.getByRole('link', { name: /Read full summary/ }).getAttribute('href'),
          },
          expected: {
            title: summaryTitle,
            moments: 3,
            record: 0,
            rail: 0,
            source: `/explorer/${dir}/actions/meetings/10-15_Atlas%20Planning.md`,
            full: `/explorer/${dir}/summary.md`,
          },
        })
        await page.screenshot({ path: '/tmp/sky-day-summary-desktop.png', fullPage: true })

        const story = page.locator('.sky-summary-story')
        const selection = await story.evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const range = document.createRange()
          range.setStart(paragraphs[0].firstChild!, 0)
          range.setEnd(paragraphs[1].lastChild!, paragraphs[1].lastChild!.textContent!.length)
          document.getSelection()!.removeAllRanges()
          document.getSelection()!.addRange(range)
          return document.getSelection()!.toString()
        })
        await writeFile(summaryFile, `${SUMMARY}\n<!-- metadata changed -->`)
        await page.waitForResponse((response) => response.url().endsWith(`/${DAY.ymd}/summary`) && response.ok())
        await page.waitForTimeout(150)
        assert({
          given: 'a selection across both story paragraphs while the saved file refreshes',
          should: 'preserve unchanged text and selection',
          actual: {
            selection: await page.evaluate(() => document.getSelection()?.toString()),
            title: await page.title(),
          },
          expected: { selection, title: summaryTitle },
        })

        const drag = await story.evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const first = paragraphs[0].firstChild!
          const last = paragraphs[1].lastChild!
          const range = document.createRange()
          range.setStart(first, 0)
          range.setEnd(first, 1)
          const start = range.getBoundingClientRect()
          range.setStart(last, last.textContent!.length - 1)
          range.setEnd(last, last.textContent!.length)
          const end = range.getBoundingClientRect()
          document.getSelection()!.removeAllRanges()
          return {
            start: { x: start.left + 1, y: start.top + start.height / 2 },
            end: { x: end.right - 1, y: end.top + end.height / 2 },
          }
        })
        await page.mouse.move(drag.start.x, drag.start.y)
        await page.mouse.down()
        await page.mouse.move(drag.end.x, drag.end.y, { steps: 10 })
        await writeFile(summaryFile, `${SUMMARY}\n<!-- another metadata change -->`)
        await page.waitForResponse((response) => response.url().endsWith(`/${DAY.ymd}/summary`) && response.ok())
        await page.waitForTimeout(150)
        await page.mouse.up()
        assert({
          given: 'a text-selection drag held across a background refresh',
          should: 'retain a range spanning the story paragraphs',
          actual: await page.evaluate(() => {
            const text = document.getSelection()?.toString() ?? ''
            return text.includes('Jane agreed') && text.includes('pottery studio')
          }),
          expected: true,
        })

        await writeFile(
          summaryFile,
          SUMMARY.replace('The Atlas pilot got a start date', 'The Atlas pilot begins on Monday'),
        )
        await page
          .getByRole('heading', { name: 'The Atlas pilot begins on Monday', exact: true })
          .waitFor({ timeout: 10000 })
        await page.getByText('Day record', { exact: true }).click()
        await page.getByText('Prepare the Atlas checklist', { exact: true }).waitFor()
        await waitForTitle(recordTitle)
        await page.waitForResponse((response) => response.url().endsWith(`/${DAY.ymd}/summary`) && response.ok())
        assert({
          given: 'the reader switches to the day record and a background refresh follows',
          should: 'keep their chosen view and leave the saved day untouched',
          actual: {
            summaryVisible: await page.locator('.sky-day-summary').count(),
            day: await readFile(file, 'utf8'),
            title: await page.title(),
            url: page.url(),
          },
          expected: { summaryVisible: 0, day: DAY_RECORD, title: recordTitle, url: `${origin}/${DAY.ymd}?view=record` },
        })

        await page.reload()
        await page.getByText('Prepare the Atlas checklist', { exact: true }).waitFor()
        await waitForTitle(recordTitle)
        assert({
          given: 'a reload after choosing Day record',
          should: 'restore the record and its tab title',
          actual: { mode: await page.locator('.sky-day').getAttribute('data-view'), title: await page.title() },
          expected: { mode: 'record', title: recordTitle },
        })
        await page.getByRole('link', { name: 'Summary file', exact: true }).click()
        await waitForTitle('sky · Daily Summary')
        await page.goBack()
        await waitForTitle(recordTitle)
        assert({
          given: 'browser Back after opening a document from Day record',
          should: 'return to the chosen view rather than the default summary',
          actual: { mode: await page.locator('.sky-day').getAttribute('data-view'), title: await page.title() },
          expected: { mode: 'record', title: recordTitle },
        })
        await page.goForward()
        await waitForTitle('sky · Daily Summary')
        await page.goBack()
        await waitForTitle(recordTitle)
        await page.getByRole('button', { name: 'Today', exact: true }).click()
        await page.getByText('Plan the next workshop', { exact: true }).waitFor()
        await waitForTitle('sky · Tuesday, April 8, 2025 · Day record')
        await page.goBack()
        await waitForTitle(recordTitle)
        await page.getByText('Summary', { exact: true }).click()
        await waitForTitle(summaryTitle)
        await page.goBack()
        await waitForTitle(recordTitle)
        await page.goForward()
        await waitForTitle(summaryTitle)
        await page.reload()
        await waitForTitle(summaryTitle)
        assert({
          given: 'Back and Forward through view choices, followed by a reload',
          should: 'restore the Summary choice and its matching tab title',
          actual: {
            mode: await page.locator('.sky-day').getAttribute('data-view'),
            title: await page.title(),
            url: page.url(),
          },
          expected: { mode: 'summary', title: summaryTitle, url: `${origin}/${DAY.ymd}?view=summary` },
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByText('Day record', { exact: true }).click()
        assert({
          given: 'the day record on a phone with the summary switch present',
          should: 'keep every header control inside the viewport',
          actual: await page.locator('.sky-day .sky-head').evaluate((element) =>
            [...element.querySelectorAll('button, [role="radiogroup"]')].every((control) => {
              const box = control.getBoundingClientRect()
              return box.left >= 0 && box.right <= window.innerWidth + 1
            }),
          ),
          expected: true,
        })
        await page.getByText('Summary', { exact: true }).click()
        await page.locator('.sky-summary-sources a').first().click()
        await page.waitForURL(`**/explorer/${dir}/actions/meetings/10-15_Atlas%20Planning.md`)
        await page.goBack()
        await page.getByRole('link', { name: /Read full summary/ }).click()
        await page.waitForURL(`**/explorer/${dir}/summary.md`)
        await page.goBack()

        for (const theme of ['light', 'dark']) {
          await page.evaluate(
            (theme) => document.documentElement.setAttribute('data-mantine-color-scheme', theme),
            theme,
          )
          await page.setViewportSize({ width: 390, height: 844 })
          await page.locator('.sky-summary-file').scrollIntoViewIfNeeded()
          assert({
            given: `a narrow screen in ${theme} mode`,
            should: 'fit the story and moments within the viewport and keep the full summary reachable',
            actual: await page.evaluate(() => {
              const nodes = [
                ...document.querySelectorAll('.sky-day-summary, .sky-summary-moment, .sky-summary-read-full'),
              ]
              return nodes.every((node) => {
                const box = node.getBoundingClientRect()
                return box.left >= 0 && box.right <= window.innerWidth + 1
              })
            }),
            expected: true,
          })
          await page.locator('.sky-day .sky-scroll').evaluate((element) => {
            element.scrollTop = 0
          })
          await page.screenshot({ path: `/tmp/sky-day-summary-mobile-${theme}.png`, fullPage: true })
        }

        await page.goto(`${origin}/${DAY.addDays(1).ymd}?view=summary`)
        await page.getByText('Plan the next workshop', { exact: true }).waitFor()
        await waitForTitle('sky · Tuesday, April 8, 2025 · Day record')
        assert({
          given: 'a summary link for a day without a saved summary',
          should: 'open its normal record with a matching title and no empty summary tab',
          actual: { switches: await page.locator('.sky-day-view-switch').count(), title: await page.title() },
          expected: { switches: 0, title: 'sky · Tuesday, April 8, 2025 · Day record' },
        })
        await page.goto(`${origin}/${DAY.addDays(-1).ymd}`)
        await page.getByText('An afternoon in the garden.', { exact: true }).waitFor()
        await waitForTitle('sky · Sunday, April 6, 2025 · Summary')
        assert({
          given: 'an older summary with no meaningful moments',
          should: 'show the saved opening without invented moments',
          actual: await page.locator('.sky-summary-moment').count(),
          expected: 0,
        })
        assert({
          given: 'summary reading, navigation, and refreshes',
          should: 'raise no browser errors',
          actual: errors,
          expected: [],
        })

        const unavailable = await page.context().newPage()
        const pendingRead = Promise.withResolvers<void>()
        try {
          await unavailable.route(`${origin}/day/${DAY.ymd}`, async (route) => {
            await pendingRead.promise
            await route.fulfill({ status: 503, json: { error: 'The test day is unavailable.' } })
          })
          await unavailable.goto(`${origin}/${DAY.ymd}?view=record`)
          await unavailable.waitForFunction(() => document.title === 'sky · 2025-04-07 · Day record')
          const loadingTitle = await unavailable.title()
          const failedRead = unavailable.waitForResponse(
            (response) => response.url() === `${origin}/day/${DAY.ymd}` && response.status() === 503,
          )
          pendingRead.resolve()
          await failedRead
          await unavailable.waitForResponse((response) => new URL(response.url()).pathname === '/chat')
          assert({
            given: 'a direct record link whose day is loading and then unavailable, while the shell refreshes',
            should: 'keep the requested day and view in the tab title',
            actual: { loading: loadingTitle, unavailable: await unavailable.title() },
            expected: { loading: 'sky · 2025-04-07 · Day record', unavailable: 'sky · 2025-04-07 · Day record' },
          })
        } finally {
          pendingRead.resolve()
          await unavailable.close()
        }
      },
    )
  },
)
