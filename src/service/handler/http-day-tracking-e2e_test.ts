import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { TRACKING_TODAY, trackingFixture } from '#lib/tracking/testHelpers.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'day tracking follows the displayed notebook day across midnight and navigation',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const f = await trackingFixture()
    const openDay = new PlainDate(TRACKING_TODAY).addDays(-1)
    const previous = openDay.addDays(-1)
    const dayMarkdown = (date: PlainDate, ended = false) =>
      `---\nstarted: 08:00\n${ended ? 'ended: 21:00\n' : ''}---\n\n# ${date.ymd}\n`
    const app = createTestHttpApp([f.dirs.timeDir, f.dirs.trackingDir], {
      now: () => new ZonedDateTime(new PlainDateTime('32:15', openDay), 'America/Chicago'),
      tracking: { store: f.store },
      chat: {
        timeDir: f.dirs.timeDir,
        createSession: async () => {
          throw new Error('This fixture does not call a model.')
        },
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    let browser
    try {
      const fields = {
        category: 'Work',
        ask: 'morning' as const,
        schedule: 'daily' as const,
        start: '2030-06-01',
        end: null,
        markdown: '',
      }
      await f.store.create(crypto.randomUUID(), {
        ...fields,
        title: 'Focus score',
        question: 'How focused did you feel?',
        columns: [{ name: 'score', type: 'number' }],
      })
      await f.store.create(crypto.randomUUID(), {
        ...fields,
        title: 'Reading log',
        question: 'What did you read?',
        entries: 'many',
        columns: [
          { name: 'pages', type: 'number', aggregate: 'sum' },
          { name: 'duration', type: 'duration', unit: 'min' },
        ],
      })
      await f.put(path.join('time', dayFile(openDay)), dayMarkdown(openDay))
      await f.put(path.join('time', dayFile(previous)), dayMarkdown(previous, true))
      await f.put(daySummaryPath(path.join('time', dayFile(previous))), '# Summary\n')
      await f.put('data/tracking/2030/focus-score.csv', `date, score\n${previous.ymd}, 3\n${TRACKING_TODAY}, 9\n`)
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server address.')
      const origin = `http://127.0.0.1:${address.port}`
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const daily = page.locator('.sky-tracking-day')
      const footer = daily.locator('.sky-tracking-day-footer .sky-tracking-hint')
      const focus = daily
        .locator('.sky-tracking-log-row')
        .filter({ has: page.getByRole('link', { name: 'Focus score', exact: true }) })
      const reading = daily
        .locator('.sky-tracking-log-row')
        .filter({ has: page.getByRole('link', { name: 'Reading log', exact: true }) })
      const waitForDay = async (date: string) => {
        const response = await page.request.get(`${origin}/day/${date}`)
        const view = await response.json()
        if (view.summary) await page.getByText('Day record', { exact: true }).click()
        await page.waitForFunction(
          (expected) =>
            document.querySelector('.sky-tracking-day-footer .sky-tracking-hint')?.textContent?.includes(expected),
          date,
        )
        await page.waitForFunction((title) => document.title === title, `sky · ${view.day.dateLabel} · Day record`)
      }

      await page.goto(origin)
      await daily.getByRole('heading', { name: 'Tracking', exact: true }).waitFor()
      assert({
        given: 'the notebook is still on the previous day at 08:15 the next morning',
        should: 'show tracking for the day in the page header, without the calendar day’s saved value',
        actual: [await footer.innerText(), await focus.getByRole('textbox').count()],
        expected: [`For ${openDay.ymd}`, 1],
      })
      await waitForDay(openDay.ymd)
      await focus.getByRole('textbox').fill('7')
      await focus.getByRole('button', { name: 'Save Focus score', exact: true }).click()
      await focus.getByRole('button', { name: 'Edit Focus score', exact: true }).waitFor()
      await reading.getByRole('button', { name: 'Log entry', exact: true }).click()
      const dialog = page.getByRole('dialog')
      assert({
        given: 'a multi-field entry opened from the day page',
        should: 'prefill the displayed day',
        actual: await dialog.getByRole('textbox', { name: 'For date', exact: true }).inputValue(),
        expected: openDay.ymd,
      })
      await dialog.getByRole('textbox', { name: 'Pages', exact: true }).fill('12')
      await dialog.getByRole('textbox', { name: 'Duration', exact: true }).fill('30m')
      await dialog.getByRole('button', { name: 'Save entry', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      const saved = await f.store.report(previous.ymd, TRACKING_TODAY)
      assert({
        given: 'inline and multi-field saves while the notebook and calendar dates differ',
        should: 'write both to the displayed day and preserve the neighboring days’ entries',
        actual: [
          saved.metrics.find((m) => m.tracker.name === 'focus-score')!.entries.map((e) => [e.date, e.values.score]),
          saved.metrics.find((m) => m.tracker.name === 'reading-log')!.entries.map((e) => [e.date, e.values]),
        ],
        expected: [
          [
            [previous.ymd, '3'],
            [openDay.ymd, '7'],
            [TRACKING_TODAY, '9'],
          ],
          [[openDay.ymd, { pages: '12', duration: '30' }]],
        ],
      })
      await reading.getByRole('button', { name: 'Add another Reading log entry', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'Pages', exact: true }).fill('8')
      await dialog.getByRole('button', { name: 'Save entry', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await reading.getByText('2 entries', { exact: true }).waitFor()
      const editX = async (row: typeof focus) => (await row.getByRole('button', { name: /^Edit / }).boundingBox())?.x
      assert({
        given: 'a second entry on a tracker that takes more than one a day',
        should: 'list it first, show the day’s total, and keep a one-a-day tracker’s pencil aligned without a +',
        actual: [
          await daily.locator('.sky-tracking-log-info > a').allInnerTexts(),
          await reading.locator('.sky-tracking-log-value').innerText(),
          await focus.getByRole('button', { name: /^Add another/ }).count(),
          await editX(focus),
        ],
        expected: [['Reading log', 'Focus score'], '20', 0, await editX(reading)],
      })

      await page
        .locator('.sky-side')
        .getByRole('button', { name: /^Tomorrow/ })
        .click()
      await waitForDay(TRACKING_TODAY)
      assert({
        given: 'navigation to the calendar day',
        should: 'show its own recorded value',
        actual: await focus.locator('.sky-tracking-log-value').innerText(),
        expected: '9',
      })
      await reading.getByRole('button', { name: 'Log entry', exact: true }).click()
      await dialog.waitFor()
      await page.goBack()
      await waitForDay(openDay.ymd)
      await dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'browser Back while another day’s entry dialog is open',
        should: 'clear that dialog and restore the viewed day’s entries',
        actual: await focus.locator('.sky-tracking-log-value').innerText(),
        expected: '7',
      })
      await page.goForward()
      await waitForDay(TRACKING_TODAY)

      await page.goto(`${origin}/week`)
      await page.getByRole('button', { name: 'Monday Jun 17', exact: true }).click()
      await page.waitForURL(origin + '/')
      await waitForDay(openDay.ymd)
      assert({
        given: 'the open notebook day selected from Week',
        should: 'keep its tracking date even when navigation returns to Today',
        actual: await focus.locator('.sky-tracking-log-value').innerText(),
        expected: '7',
      })
      await page
        .locator('.sky-side')
        .getByRole('button', { name: /^Yesterday/ })
        .click()
      await waitForDay(previous.ymd)
      assert({
        given: 'a summarized previous day selected in the sidebar',
        should: 'show only its records with no editing controls',
        actual: [await focus.locator('.sky-tracking-log-value').innerText(), await daily.getByRole('button').count()],
        expected: ['3', 0],
      })

      await f.put(path.join('time', dayFile(openDay)), dayMarkdown(openDay, true))
      await f.put(daySummaryPath(path.join('time', dayFile(openDay))), '# Summary\n')
      await page.goto(origin)
      await waitForDay(openDay.ymd)
      assert({
        given: 'Today still points to a notebook day with a saved summary',
        should: 'keep that day’s tracking read-only too',
        actual: [await focus.locator('.sky-tracking-log-value').innerText(), await daily.getByRole('button').count()],
        expected: ['7', 0],
      })
      await page.goto(`${origin}/tracking/reading-log`)
      await page.locator('.sky-tracking-heading').getByRole('button', { name: 'Log entry', exact: true }).click()
      assert({
        given: 'a new observation in standalone Tracking',
        should: 'still default to the calendar date without browser errors',
        actual: [await dialog.getByRole('textbox', { name: 'For date', exact: true }).inputValue(), errors],
        expected: [TRACKING_TODAY, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
