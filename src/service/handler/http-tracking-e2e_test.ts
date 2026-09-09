import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium, type Page } from 'playwright'
import { appendRecord, recordFilePath } from '#commands/all/track/lib/records.ts'
import { sleepInput, TRACKING_TODAY, trackingFixture } from '#lib/tracking/testHelpers.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'tracking works from Today through history, sentence review, setup, and archive on desktop and phone',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 150000,
  },
  async () => {
    const f = await trackingFixture(async (_definition, text) =>
      text === 'unreadable'
        ? null
        : {
            date: text === 'unclear date' ? null : new PlainDate('2030-06-17'),
            values: { duration: '7.75', notes: 'A late dinner' },
          },
    )
    const shots = env.get('SKY_TRACKING_SCREENSHOTS')
    let browser, currentPage: Page | undefined
    const unavailable = async (): Promise<never> => {
      throw new Error('This fixture does not call a model.')
    }
    const app = createTestHttpApp([f.dirs.timeDir, f.dirs.trackingDir], {
      tracking: { store: f.store },
      chat: { timeDir: f.dirs.timeDir, createSession: unavailable },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    try {
      if (shots) await mkdir(shots, { recursive: true })
      await f.store.create(crypto.randomUUID(), sleepInput)
      await f.store.create(crypto.randomUUID(), {
        ...sleepInput,
        title: 'Weight',
        question: 'What is your weight this morning?',
        columns: [{ name: 'weight', type: 'number', unit: 'kg', aggregate: 'last' }],
        markdown: 'Watch the longer trend.\n',
      })
      await f.store.create(crypto.randomUUID(), {
        ...sleepInput,
        title: 'Focused work',
        category: 'Work',
        ask: 'evening',
        question: 'How much focused work did you do?',
        columns: [
          { name: 'duration', type: 'duration', unit: 'hr', aggregate: 'sum' },
          { name: 'notes', type: 'text' },
        ],
        markdown: 'Make room for the work that matters.\n',
      })
      await f.store.create(crypto.randomUUID(), {
        ...sleepInput,
        title: 'Running',
        schedule: 'manual',
        ask: 'anytime',
        question: 'How was your run?',
        columns: [
          { name: 'distance', type: 'number', unit: 'km', aggregate: 'sum' },
          { name: 'duration', type: 'duration', unit: 'min' },
          { name: 'notes', type: 'text' },
        ],
        markdown: 'Build a comfortable routine.\n',
      })
      await f.put(
        'data/tracking/2030/sleep.csv',
        'date, duration (hr), notes\n' +
          Array.from(
            { length: 17 },
            (_, at) =>
              `2030-06-${String(at + 1).padStart(2, '0')}, ${[7.5, 7, 8, 6.75, 7.25][at % 5]}, "${at === 16 ? 'A quiet evening.' : ''}"\n`,
          ).join(''),
      )
      await f.put(
        'data/tracking/2030/weight.csv',
        'date, weight (kg)\n2030-06-01, 77.4\n2030-06-04, 77.1\n2030-06-08, 77.2\n2030-06-11, 77\n2030-06-15, 76.9\n2030-06-18, 76.8\n',
      )
      await f.put(
        'data/tracking/2030/focused-work.csv',
        'date, duration (hr), notes\n2030-06-12, 2.5\n2030-06-13, 3\n2030-06-14, 1\n2030-06-15, 2\n2030-06-17, 2.5\n',
      )
      await f.put(
        'data/tracking/2030/running.csv',
        'date, distance (km), duration (min), notes\n2030-06-10, 5, 30\n2030-06-14, 7, 42\n2030-06-17, 4, 24\n',
      )
      await f.put(
        path.join('time', dayFile(new PlainDate('2030-06-17'))),
        '---\nstarted: 8:00\nended: 12h\n---\n\n# 2030-06-17\n\n## Most Important\n\n- Review the Atlas brief\n',
      )
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing browser test server address.')
      const origin = `http://127.0.0.1:${address.port}`
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page: Page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      currentPage = page
      page.setDefaultTimeout(10000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const shot = async (name: string) => {
        if (shots)
          await page!.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true, animations: 'disabled' })
      }
      const daily = page.locator('.sky-tracking-day')
      await page.goto(`${origin}/`)
      await daily.getByRole('link', { name: 'View trends', exact: true }).click()
      await page.waitForURL('**/tracking')
      await page.getByRole('heading', { name: 'Sleep', exact: true }).waitFor()
      assert({
        given: 'View trends in Today’s Tracking section',
        should: 'open existing trackers without a Tracking sidebar destination',
        actual: [
          await page.locator('.sky-tracking-card').count(),
          await page.getByRole('button', { name: 'Tracking', exact: true }).count(),
        ],
        expected: [4, 0],
      })
      await shot('overview-desktop')
      await page.goto(`${origin}/`)
      await daily.getByRole('textbox', { name: 'Sleep in hr', exact: true }).fill('7h 30m')
      await shot('today-desktop')
      await daily.getByRole('button', { name: 'Save Sleep', exact: true }).click()
      await daily.getByRole('button', { name: 'Edit Sleep', exact: true }).waitFor()
      assert({
        given: 'quick capture on Today',
        should: 'save using the tracking calendar day, independently of the open notebook day',
        actual: (await f.store.report()).metrics.find((m) => m.tracker.name === 'sleep')!.entries.at(-1)!.date,
        expected: TRACKING_TODAY,
      })
      await daily.getByRole('button', { name: 'Undo', exact: true }).click()
      await daily.getByRole('textbox', { name: 'Sleep in hr', exact: true }).waitFor()
      await daily.getByRole('button', { name: 'Later', exact: true }).click()
      assert({
        given: 'Later',
        should: 'defer without inserting a value',
        actual: (await f.store.report()).metrics.find((m) => m.tracker.name === 'sleep')!.entries.length,
        expected: 17,
      })
      await daily.getByRole('button', { name: 'Undo', exact: true }).click()
      await daily.getByRole('textbox', { name: 'Sleep in hr', exact: true }).fill('8')
      await daily.getByRole('button', { name: 'Save Sleep', exact: true }).click()
      await daily.getByRole('button', { name: 'Edit Sleep', exact: true }).waitFor()

      await page.goto(`${origin}/tracking/sleep`)
      const edit = page.getByRole('button', { name: 'Edit Sleep on 2030-06-18', exact: true })
      await edit.click()
      let dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Duration', exact: true }).fill('7h 45m')
      await dialog.getByRole('textbox', { name: 'Notes', exact: true }).fill('Read before bed')
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByText('Read before bed', { exact: true }).waitFor()
      await shot('history-desktop')
      const note = page.getByText('Read before bed', { exact: true })
      await note.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const selection = getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      const tracker = (await f.store.report()).metrics.find((m) => m.tracker.name === 'sleep')!.tracker
      const doc = TrackingDocument.fromMarkdown(await readFile(path.join(f.root, tracker.path), 'utf8'))
      await appendRecord(
        recordFilePath(f.dirs, doc, new PlainDate(TRACKING_TODAY)),
        doc,
        new PlainDate(TRACKING_TODAY),
        { duration: '1', notes: 'A short nap' },
      )
      const refresh = page.waitForResponse((response) => response.url().includes('/tracking/_api/report'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await refresh
      await page.getByText('A short nap', { exact: true }).waitFor()
      assert({
        given: 'a background refresh with new file content',
        should: 'show the new row and preserve selection in an unchanged row',
        actual: await page.evaluate(() => getSelection()?.toString()),
        expected: 'Read before bed',
      })
      await page.evaluate(() => getSelection()?.removeAllRanges())

      await page.locator('.sky-tracking-heading').getByRole('button', { name: 'Log entry', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByText('Write a sentence', { exact: true }).click()
      await dialog
        .getByRole('textbox', { name: 'What would you like to record?', exact: true })
        .fill('Yesterday I slept 7 hours 45 minutes after a late dinner.')
      const before = (await f.store.report()).metrics.find((m) => m.tracker.name === 'sleep')!.entries.length
      await dialog.getByRole('button', { name: 'Review entry', exact: true }).click()
      await dialog.getByText('2030-06-17', { exact: true }).waitFor()
      assert({
        given: 'sentence review',
        should: 'show the resolved date before any write',
        actual: (await f.store.report()).metrics.find((m) => m.tracker.name === 'sleep')!.entries.length,
        expected: before,
      })
      await shot('sentence-review')
      await dialog.getByRole('button', { name: 'Save entry', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByText('A late dinner', { exact: true }).waitFor()
      await page.locator('.sky-tracking-heading').getByRole('button', { name: 'Log entry', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByText('Write a sentence', { exact: true }).click()
      await dialog.getByRole('textbox', { name: 'What would you like to record?', exact: true }).fill('unclear date')
      await dialog.getByRole('button', { name: 'Review entry', exact: true }).click()
      await dialog.getByText('Choose the date this entry belongs to.', { exact: true }).waitFor()
      assert({
        given: 'an unresolved date',
        should: 'leave the date blank and block saving',
        actual: [
          await dialog.getByRole('textbox', { name: 'For date', exact: true }).inputValue(),
          await dialog.getByRole('button', { name: 'Save entry', exact: true }).isDisabled(),
        ],
        expected: ['', true],
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

      await page.goto(`${origin}/tracking/new`)
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Energy')
      await page.getByRole('textbox', { name: 'Question to ask you', exact: true }).fill('How was your energy today?')
      await page.getByRole('textbox', { name: 'Answer 1 name', exact: true }).fill('energy')
      await page.getByRole('textbox', { name: 'Answer 1 unit', exact: true }).fill('of 5')
      await page.getByRole('checkbox', { name: 'Include optional notes', exact: true }).check()
      await page.getByRole('combobox', { name: 'Ask me', exact: true }).selectOption('evening')
      await shot('setup-desktop')
      await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
      await page.waitForURL('**/tracking/energy')
      await page.getByRole('heading', { name: 'Energy', exact: true }).waitFor()
      assert({
        given: 'the setup screen',
        should: 'persist a new definition using the selected question, fields and window',
        actual: (await f.store.report()).metrics.find((m) => m.tracker.name === 'energy')!.tracker.ask,
        expected: 'evening',
      })
      await page.getByRole('button', { name: 'Tracker settings', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Archive tracker', exact: true }).click()
      await page.getByText('Archived', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await page.locator('.sky-tracking-heading').getByRole('button', { name: 'Log entry', exact: true }).waitFor()

      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const route of ['/tracking', '/tracking/sleep', '/tracking/new', '/']) {
          await page.goto(`${origin}${route}`)
          await page.locator(route === '/' ? '.sky-tracking-day-heading' : '.sky-tracking-heading').waitFor()
          assert({
            given: `${route} at ${width}px`,
            should: 'keep the page within the viewport',
            actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            expected: false,
          })
          if (width === 390) await shot(`${route === '/' ? 'today' : route.split('/').at(-1) || 'overview'}-mobile`)
        }
      }
      await page.setViewportSize({ width: 390, height: 900 })
      await page.goto(`${origin}/tracking/running`)
      await page.locator('.sky-tracking-heading').getByRole('button', { name: 'Log entry', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('6')
      await dialog.getByRole('textbox', { name: 'Duration', exact: true }).fill('36m')
      await shot('capture-mobile')
      await dialog.getByRole('button', { name: 'Save entry', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'multi-field capture in the phone drawer',
        should: 'save all declared values with the correct duration unit',
        actual: (await f.store.report()).metrics.find((m) => m.tracker.name === 'running')!.entries.at(-1)!.values,
        expected: { distance: '6', duration: '36', notes: '' },
      })
      await page.goto(`${origin}/2030-06-17`)
      await daily.getByRole('heading', { name: 'Tracking', exact: true }).waitFor()
      assert({
        given: 'an ended dated day',
        should: 'show that day’s observations without editing controls',
        actual: [
          (await daily.locator('.sky-tracking-day-heading p').innerText()).startsWith('2030-06-17'),
          await daily.getByRole('button').count(),
        ],
        expected: [true, 0],
      })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await f.put('data/tracking/2028/sleep.csv', 'date, duration (hr), notes\n2028-06-12, 8, "Earlier sleep record"\n')
      await page.goto(`${origin}/tracking`)
      await page.getByRole('heading', { name: 'Sleep', exact: true }).waitFor()
      await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('all')
      await page
        .getByRole('img', { name: 'duration from 2028-06-12 to 2030-06-18. Missing entries are gaps.', exact: true })
        .first()
        .waitFor()
      const sleepCard = page
        .locator('.sky-tracking-card')
        .filter({ has: page.getByRole('heading', { name: 'Sleep', exact: true }) })
      const runningCard = page
        .locator('.sky-tracking-card')
        .filter({ has: page.getByRole('heading', { name: 'Running', exact: true }) })
      assert({
        given: 'All time in the overview',
        should: 'show sleep as a daily average while retaining cumulative distance with its daily average alongside',
        actual: [
          (await sleepCard.innerText()).includes('Daily average · 19 days logged'),
          await runningCard.locator('.sky-tracking-card-value').innerText(),
          await runningCard.getByText('Daily average · 5.5 km', { exact: true }).count(),
        ],
        expected: [true, '22 km', 1],
      })
      await shot('all-time-overview')
      await page.getByRole('link', { name: 'View Sleep history', exact: true }).click()
      await page.waitForURL('**/tracking/sleep')
      await page.getByText('Earlier sleep record', { exact: true }).waitFor()
      const exported = await page.request.get(
        origin + (await page.getByRole('link', { name: 'Export', exact: true }).getAttribute('href')),
      )
      assert({
        given: 'opening a tracker after choosing All time',
        should: 'retain the selection and include older records in the table and export',
        actual: [
          await page.getByRole('combobox', { name: 'Date range', exact: true }).inputValue(),
          (await exported.text()).includes('Earlier sleep record'),
        ],
        expected: ['all', true],
      })
      await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('custom')
      assert({
        given: 'switching from All time to custom dates',
        should: 'seed the custom range from the actual history',
        actual: await page.getByRole('textbox', { name: 'Range start', exact: true }).inputValue(),
        expected: '2028-06-12',
      })
      await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('7')
      await page.getByText('Earlier sleep record', { exact: true }).waitFor({ state: 'hidden' })
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('all')
      await page.getByText('Earlier sleep record', { exact: true }).waitFor()
      assert({
        given: 'All time on a phone',
        should: 'fit the existing page layout',
        actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        expected: false,
      })
      await shot('all-time-sleep-mobile')
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`${origin}/tracking/running`)
      await page.locator('.sky-tracking-stats').getByText('Daily average', { exact: true }).waitFor()
      await shot('distance-total-and-average')
      await page.goto(`${origin}/tracking`)
      await page.getByRole('heading', { name: 'Sleep', exact: true }).waitFor()
      await page.evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'))
      await shot('overview-dark')
      await page.goto(`${origin}/tracking/sleep`)
      await page.getByRole('button', { name: 'Discuss with Sky', exact: true }).click()
      await page.waitForURL('**/thread/*')
      const composer = page.locator('.sky-composer textarea')
      await composer.waitFor()
      assert({
        given: 'Discuss with Sky',
        should: 'prepare a draft with the selected data and leave sending to the user',
        actual: [
          (await composer.inputValue()).includes('Read before bed'),
          (await composer.inputValue()).includes('data/tracking/2030/sleep.csv'),
          errors,
        ],
        expected: [true, true, []],
      })
    } catch (error) {
      if (shots && currentPage)
        await currentPage.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
