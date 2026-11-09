import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { exists } from '#shared/fs/mod.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { reviewFixture, REVIEW_DAY, REVIEW_TODAY } from './day/review/testFixture.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'a running daily summary stops from the review and starts again on request',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const f = await reviewFixture()
    // The first run waits for Stop; the next one writes the file as the fixture does.
    const summarize = f.runtime.summarize
    let summaries = 0
    f.runtime.summarize = (ymd, signal) => {
      if (++summaries > 1) return summarize(ymd, signal)
      return new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('The operation was aborted.')))
      })
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
      await f.idle.sample(0, 0, REVIEW_DAY, REVIEW_DAY, 5)
      await f.idle.sample(6 * 3_600_000, 0, REVIEW_DAY, REVIEW_TODAY, 5)
      await page.goto(origin)
      const dialog = page.getByRole('dialog', { name: `Review ${REVIEW_DAY}` })
      await dialog.waitFor()
      for (const heading of [
        'What’s coming with you?',
        'Which reminders still matter?',
        'Did you do these?',
        'Fill in the missing pieces',
        'Anything worth keeping?',
        'Keep the conversation going',
      ]) {
        await dialog.getByRole('heading', { name: heading }).waitFor()
        await dialog.getByRole('button', { name: /^(Skip this step|Continue)$/ }).click()
      }
      await dialog.getByRole('heading', { name: 'Your day, brought together' }).waitFor()
      await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
      await dialog.getByRole('button', { name: 'Start again' }).waitFor()
      assert({
        given: 'Stop while the summary runs',
        should: 'end it with nothing written and offer Start again',
        actual: [
          await dialog.getByText('Stopped. Nothing was written.').count(),
          (await f.view()).summary.status,
          await exists(daySummaryPath(f.file(REVIEW_DAY))),
          summaries,
          errors,
        ],
        expected: [1, 'stopped', false, 1, []],
      })
      await dialog.getByRole('button', { name: 'Start again' }).click()
      await dialog.getByRole('button', { name: 'Read summary' }).waitFor()
      assert({
        given: 'Start again',
        should: 'write the summary once more and offer it',
        actual: [summaries, await exists(daySummaryPath(f.file(REVIEW_DAY))), errors],
        expected: [2, true, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
