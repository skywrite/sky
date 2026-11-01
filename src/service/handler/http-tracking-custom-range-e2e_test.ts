import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { TRACKING_TODAY, trackingFixture } from '#lib/tracking/testHelpers.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'tracking - typing custom date ranges keeps the overview and metric page usable on desktop and phone',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const f = await trackingFixture()
    let browser
    const app = createTestHttpApp([f.dirs.timeDir, f.dirs.trackingDir], {
      now: () => new ZonedDateTime(new PlainDateTime('08:15', TRACKING_TODAY), 'America/Chicago'),
      tracking: { store: f.store },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const errors: string[] = []
    try {
      await f.store.create(crypto.randomUUID(), {
        title: 'Atlas score',
        question: 'What is the Atlas score today?',
        category: 'Work',
        ask: 'anytime',
        schedule: 'daily',
        start: '2030-06-01',
        end: null,
        columns: [{ name: 'score', type: 'number', aggregate: 'mean' }],
        markdown: 'Follow the Atlas score over time.\n',
      })
      await f.put(
        'data/tracking/2030/atlas-score.csv',
        'date, score\n2030-06-01, 1\n2030-06-10, 4\n2030-06-12, 8\n2030-06-15, 10\n2030-06-18, 12\n',
      )
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing browser test server address.')
      const origin = `http://127.0.0.1:${address.port}`
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage()
      page.setDefaultTimeout(5000)
      page.on('pageerror', (error) => errors.push(error.message))
      const reports: URL[] = []
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname === '/tracking/_api/report') reports.push(url)
      })
      const start = page.getByRole('textbox', { name: 'Range start', exact: true })
      const end = page.getByRole('textbox', { name: 'Range end', exact: true })
      const apply = page.getByRole('button', { name: 'Apply', exact: true })
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const route of ['/tracking/atlas-score', '/tracking']) {
          const title = route === '/tracking' ? 'Tracking' : 'Atlas score'
          await page.goto(`${origin}${route}`)
          await page.getByRole('heading', { name: title, exact: true }).waitFor()
          const custom = page.waitForResponse((response) => {
            const url = new URL(response.url())
            return url.pathname === '/tracking/_api/report' && url.searchParams.has('start')
          })
          await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('custom')
          await custom
          const beforeTyping = reports.length
          await start.fill('2030-06-1')
          await start.pressSequentially('0')
          await end.fill('2030-06-1')
          await end.pressSequentially('5')
          assert({
            given: `custom dates typed on ${route} at ${width}px`,
            should: 'retain both inputs and the page title, and wait for Apply before fetching the edited range',
            actual: [
              await start.inputValue(),
              await end.inputValue(),
              await page.title(),
              reports.length - beforeTyping,
              errors,
            ],
            expected: ['2030-06-10', '2030-06-15', `sky · ${title}`, 0, []],
          })
          const applied = page.waitForResponse((response) => {
            const url = new URL(response.url())
            return (
              url.pathname === '/tracking/_api/report' &&
              url.searchParams.get('start') === '2030-06-10' &&
              url.searchParams.get('end') === '2030-06-15'
            )
          })
          await apply.click()
          await applied
          await page.getByText('3 days logged', { exact: false }).waitFor()
          await start.fill('2030-06-')
          await apply.click()
          await page.getByText('Use YYYY-MM-DD for both dates.', { exact: true }).waitFor()
          assert({
            given: 'an incomplete date submitted after applying a valid range',
            should: 'show a validation message while keeping the input and the existing chart visible',
            actual: [
              await start.inputValue(),
              await end.inputValue(),
              await page.getByText('3 days logged', { exact: false }).isVisible(),
              errors,
            ],
            expected: ['2030-06-', '2030-06-15', true, []],
          })
        }
      }
    } catch (error) {
      if (errors.length) throw new Error(errors.join('\n'), { cause: error })
      throw error
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
