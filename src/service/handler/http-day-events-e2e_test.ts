import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { ThreadSummary } from './theme/client/day.tsx'

const DAY = new PlainDate('2026-01-27')
const EMPTY_DAY = DAY.addDays(-1)
const EVENT = path.posix.join('time', dayDir(DAY), 'actions/events/Pottery [workshop].md')
const CONTENT = `---
what: Pottery workshop
when: 2026-01-27 18:30 - 20:00
who:
  - Jane Doe
  - Sam Lee
where: Atlas Studio
---

# Pottery workshop

We learned to shape a bowl and chose a blue glaze.
`

test(
  { name: 'saved events appear in the day record and survive navigation and background refreshes', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `---\ndate: ${DAY.ymd}\n---\n\n## Personal Complete\n\n- 18:30 > Event -> [Pottery workshop](actions/events/Pottery [workshop].md)\n`,
        tempPrefix: 'sky-day-events-browser-',
        file: path.posix.join('time', dayFile(DAY)),
        day: true,
        now: new ZonedDateTime('2026-01-27T12:00:00', 'UTC'),
        files: {
          [EVENT]: CONTENT,
          [path.posix.join('time', dayFile(EMPTY_DAY))]: '## Professional Todos\n\n- Plan the next workshop\n',
        },
      },
      async ({ page, origin, file, errors }) => {
        let threads: ThreadSummary[] = []
        await page.route('**/chat', (route) => route.fulfill({ json: { threads } }))
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        const section = page
          .locator('.sky-block')
          .filter({ has: page.locator('.sky-block-head', { hasText: 'Events' }) })
        const link = section.getByRole('link', { name: 'Pottery workshop', exact: true })
        const href = `/explorer/${EVENT.split('/').map(encodeURIComponent).join('/')}`
        const title = 'sky · Tuesday, January 27, 2026 · Day record'
        const waitForTitle = (title: string) => page.waitForFunction((title) => document.title === title, title)
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await link.waitFor()
        await waitForTitle(title)
        assert({
          given: 'an event file and its capture log in the day file',
          should: 'show one linked event with its time, participants, location, and count',
          actual: {
            rows: await section.locator('.sky-rec-line').count(),
            count: await section.locator('.sky-count').textContent(),
            time: await section.locator('.sky-dat').textContent(),
            metadata: await section.locator('.sky-rec-sub').textContent(),
            href: await link.getAttribute('href'),
            title: await page.title(),
          },
          expected: {
            rows: 1,
            count: '1',
            time: '18:30 - 20:00',
            metadata: 'Jane Doe, Sam Lee · Atlas Studio',
            href,
            title,
          },
        })
        for (const width of [1500, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          assert({
            given: `an event on a ${width}px window`,
            should: 'keep its details inside the day column',
            actual: await section.evaluate((node) => node.scrollWidth <= node.clientWidth),
            expected: true,
          })
        }
        await link.click()
        await page.waitForURL(`${origin}${href}`)
        await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        await page.goBack()
        await link.waitFor()
        await waitForTitle(title)

        const selection = await section.locator('.sky-rec-line').evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          document.getSelection()!.removeAllRanges()
          document.getSelection()!.addRange(range)
          return document.getSelection()!.toString()
        })
        const refresh = page.waitForResponse((response) => response.url().endsWith(`/day/${DAY.ymd}`))
        threads = [
          {
            id: 'test-chat',
            title: 'Another conversation',
            day: DAY.ymd,
            when: '12:00',
            state: 'done',
            line: null,
            turns: 1,
            inherited: 0,
            saved: null,
            parent: null,
            busy: false,
          },
        ]
        await refresh
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert({
          given: 'a background chat refresh while the event text is selected',
          should: 'preserve the selection and the day title',
          actual: {
            selection: await page.evaluate(() => document.getSelection()?.toString()),
            title: await page.title(),
          },
          expected: { selection, title },
        })
        await writeFile(
          path.join(path.dirname(file), 'actions/events/Pottery [workshop].md'),
          CONTENT.replaceAll('Pottery workshop', 'Glazing workshop'),
        )
        threads = []
        await section.getByRole('link', { name: 'Glazing workshop', exact: true }).waitFor()
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page
          .locator('.sky-side-dates button')
          .filter({ has: page.locator(`time[datetime="${EMPTY_DAY.ymd}"]`) })
          .click()
        await waitForTitle('sky · Monday, January 26, 2026 · Day record')
        assert({
          given: 'navigation to a day with no saved events',
          should: 'hide the Events section',
          actual: await section.count(),
          expected: 0,
        })
        await page.goBack()
        await section.getByRole('link', { name: 'Glazing workshop', exact: true }).waitFor()
        await waitForTitle(title)
        await page.goForward()
        await waitForTitle('sky · Monday, January 26, 2026 · Day record')
        assert({
          given: 'event navigation and refreshes',
          should: 'have no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
