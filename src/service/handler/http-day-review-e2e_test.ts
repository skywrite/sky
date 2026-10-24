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
    name: 'morning review resumes real saved choices on desktop and phone, without starting or ending a day',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120000,
  },
  async () => {
    const f = await reviewFixture()
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
      const shots = env.get('SKY_REVIEW_SCREENSHOTS')
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true })
      }
      await page.waitForFunction((day) => document.title === `sky · Review ${day}`, REVIEW_DAY)
      await dialog.getByRole('button', { name: 'Move to today (3)' }).click()
      await dialog.getByRole('button', { name: 'Move to today (3)' }).waitFor({ state: 'detached' })
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()
      await dialog.getByRole('button', { name: 'Done', exact: true }).waitFor({ state: 'detached' })
      await dialog.getByRole('button', { name: 'Enter', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'hours', exact: true }).fill('3.25')
      await dialog.getByRole('button', { name: 'Enter', exact: true }).click()
      await dialog.getByRole('button', { name: 'Enter', exact: true }).click()
      assert({
        given: 'a tracking answer collapsed before the next poll',
        should: 'retain the typed value',
        actual: await dialog.getByRole('textbox', { name: 'hours', exact: true }).inputValue(),
        expected: '3.25',
      })
      await f.waitFor((view) => Object.values(view.drafts).some((draft) => draft.hours === '3.25'))
      await dialog.getByRole('button', { name: 'Close for now' }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.reload()
      await page.getByRole('button', { name: 'Review yesterday', exact: true }).click()
      await dialog.waitFor()
      await dialog.getByRole('button', { name: 'Enter', exact: true }).click()
      assert({
        given: 'close and reload',
        should: 'keep the unfinished tracking draft',
        actual: await dialog.getByRole('textbox', { name: 'hours', exact: true }).inputValue(),
        expected: '3.25',
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('dialog', { name: `Review ${REVIEW_DAY}` }).waitFor()
      if (shots) await page.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true })
      await dialog.getByRole('button', { name: `Save for ${REVIEW_DAY}` }).click()
      await dialog.getByRole('button', { name: `Save for ${REVIEW_DAY}` }).waitFor({ state: 'detached' })
      await dialog.getByRole('button', { name: 'Skip', exact: true }).click()
      await dialog.getByRole('button', { name: 'Read summary' }).click()
      await page.waitForURL(`**/${REVIEW_DAY}?view=summary`)
      await page.getByRole('button', { name: 'Review this day' }).click()
      await dialog.waitFor()
      await dialog.getByRole('button', { name: 'Read summary' }).waitFor()
      assert({
        given: 'completed review reopened from the original day',
        should: 'preserve choices and run one summary, with no lifecycle command',
        actual: [
          await dialog.getByRole('button', { name: 'Move to today (3)' }).count(),
          f.calls.filter((c) => ['start', 'end', 'summary'].includes(c)),
          errors,
        ],
        expected: [0, ['summary'], []],
      })
      await dialog.getByRole('button', { name: 'Close for now' }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.goto(`${origin}/${REVIEW_DAY}?review=${REVIEW_DAY}`)
      await dialog.getByRole('button', { name: 'Read summary' }).waitFor()
      await page.goBack()
      await dialog.waitFor({ state: 'detached' })
      await page.goForward()
      await dialog.waitFor()
      await page.waitForFunction((day) => document.title === `sky · Review ${day}`, REVIEW_DAY)
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
