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
    name: 'a missing recap holds the summary until the person runs it from the review',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const f = await reviewFixture()
    // The Slack recap has no file yet; running it saves one, as the real command does.
    const saved = new Set(['github', 'codex', 'claude-code'])
    f.runtime.recaps = async () =>
      ['slack', 'github', 'codex', 'claude-code'].map((id) => ({ id, title: `${id} recap`, saved: saved.has(id) }))
    const recap = f.runtime.recap
    f.runtime.recap = async (id, day) => {
      const message = await recap(id, day)
      saved.add(id)
      return message
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
    const screenshots = env.get('SKY_REVIEW_RECAPS_SCREENSHOTS')
    let browser
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No test server port.')
      const origin = `http://127.0.0.1:${address.port}`
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } })
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
      await dialog.getByRole('heading', { name: 'Some recaps aren’t ready' }).waitFor()
      const held = {
        summary: (await f.view()).summary.status,
        missing: await dialog.getByText('Missing', { exact: true }).count(),
        calls: f.calls.filter((call) => call === 'slack' || call === 'summary'),
      }
      if (screenshots)
        await page.screenshot({ path: path.join(screenshots, 'recaps-held.png'), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Run missing recaps (1)' }).click()
      await dialog.getByRole('button', { name: 'Read summary' }).waitFor()
      if (screenshots) await page.screenshot({ path: path.join(screenshots, 'recaps-run.png'), animations: 'disabled' })
      assert({
        given: 'the Slack recap missing when the review reaches its summary, then Run missing recaps',
        should: 'hold the summary without running anything, then save the recap before writing the summary',
        actual: [held, f.calls.filter((call) => call === 'slack' || call === 'summary'), errors],
        expected: [{ summary: 'waiting', missing: 1, calls: [] }, ['slack', 'summary'], []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
