import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { reviewFixture, REVIEW_DAY, REVIEW_TODAY } from './day/review/testFixture.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'the morning review starts the waiting day as it shows, and says why when it cannot',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const f = await reviewFixture()
    // The first start fails the way day:start does without a network; Try again runs the fixture's own.
    const commands = f.dayOptions.commands!
    const startDay = commands.startDay
    commands.startDay = async () => {
      throw new Error('The weather service did not answer.')
    }
    const app = new Hono()
    app.route('/day-review/_api', f.app)
    app.route(
      '/',
      createTestHttpApp([f.timeDir], {
        now: f.now,
        userDataDir: path.join(f.root, '.state'),
        chat: {
          timeDir: f.timeDir,
          createSession: async () => {
            throw new Error('No model in this fixture.')
          },
        },
        week: f.dayOptions.commands,
        tracking: { store: f.tracking },
        streaks: { store: f.streaks },
      }),
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    let browser
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No test server port.')
      const origin = `http://127.0.0.1:${address.port}`
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      page.setDefaultTimeout(15000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const shots = env.get('SKY_REVIEW_SCREENSHOTS')
      if (shots) await mkdir(shots, { recursive: true })
      await f.idle.sample(0, 0, REVIEW_DAY, REVIEW_DAY, 5)
      await f.idle.sample(6 * 3_600_000, 0, REVIEW_DAY, REVIEW_TODAY, 5)
      await page.goto(origin)
      const dialog = page.getByRole('dialog', { name: `Review ${REVIEW_DAY}` })
      await dialog.waitFor()
      const failure = dialog.getByRole('alert').filter({ hasText: 'Sky couldn’t start Tuesday' })
      await failure.waitFor()
      if (shots) await page.screenshot({ path: path.join(shots, 'start-failed.png') })
      assert({
        given: 'the return prompt showing while day:start fails',
        should: 'name the day that did not start, say why, and offer Try again',
        actual: [
          (await failure.textContent())?.includes('Sky couldn’t start Tuesday: The weather service did not answer.'),
          await failure.getByRole('button', { name: 'Try again' }).count(),
          f.calls.filter((call) => call === 'start').length,
        ],
        expected: [true, 1, 0],
      })
      commands.startDay = startDay
      await failure.getByRole('button', { name: 'Try again' }).click()
      const started = dialog.getByText('Tuesday has started. Anything you add now goes there.')
      await started.waitFor()
      if (shots) {
        await page.screenshot({ path: path.join(shots, 'started.png') })
        await page.setViewportSize({ width: 390, height: 844 })
        await started.waitFor()
        await page.screenshot({ path: path.join(shots, 'started-phone.png') })
      }
      assert({
        given: 'Try again',
        should: 'start the waiting day once, say so, and keep the review where it was',
        actual: [
          f.calls.filter((call) => call === 'start').length,
          await dialog.getByRole('alert').count(),
          await dialog.getByRole('heading', { name: 'What’s coming with you?' }).count(),
          errors,
        ],
        expected: [1, 0, 1, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
