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
      await dialog.getByRole('heading', { name: 'What’s coming with you?' }).waitFor()
      const shots = env.get('SKY_REVIEW_SCREENSHOTS')
      if (shots) {
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true })
      }
      await page.waitForFunction((day) => document.title === `sky · Review ${day} · Tasks`, REVIEW_DAY)
      assert({
        given: 'the first wizard step',
        should: 'focus on tasks while later decisions stay out of the way',
        actual: [
          await dialog.getByRole('heading', { name: 'What’s coming with you?' }).count(),
          await dialog.getByRole('textbox').count(),
        ],
        expected: [1, 0],
      })
      await dialog.getByRole('button', { name: 'Move to today (3)' }).click()
      await dialog.getByRole('button', { name: 'Move to today (3)' }).waitFor({ state: 'detached' })
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()
      await dialog.getByRole('button', { name: 'Done', exact: true }).waitFor({ state: 'detached' })
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'hours', exact: true }).fill('3.25')
      await dialog.getByRole('button', { name: 'Back', exact: true }).click()
      await dialog.getByRole('heading', { name: 'Did you do these?' }).waitFor()
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      assert({
        given: 'Back and Continue before the next poll',
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
      await dialog.getByRole('textbox', { name: 'hours', exact: true }).waitFor()
      assert({
        given: 'close and reload',
        should: 'resume the saved step with its unfinished tracking draft',
        actual: [await dialog.getByRole('textbox', { name: 'hours', exact: true }).inputValue(), (await f.view()).step],
        expected: ['3.25', 'tracking'],
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('dialog', { name: `Review ${REVIEW_DAY}` }).waitFor()
      if (shots) await page.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true })
      await dialog.getByRole('button', { name: `Save for ${REVIEW_DAY}` }).click()
      await dialog.getByRole('button', { name: `Save for ${REVIEW_DAY}` }).waitFor({ state: 'detached' })
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await dialog.getByRole('heading', { name: 'Anything worth keeping?' }).waitFor()
      await dialog.getByRole('button', { name: 'Skip this step' }).click()
      await dialog.getByRole('heading', { name: 'Keep the conversation going' }).waitFor()
      if (shots) await page.screenshot({ path: path.join(shots, 'continuing-chats-phone.png'), fullPage: true })
      await dialog
        .locator('.sky-review-item')
        .filter({ hasText: 'Widget questions' })
        .getByRole('button', { name: 'Save & close' })
        .click()
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await dialog.getByRole('button', { name: 'Read summary' }).waitFor()
      assert({
        given: 'one continuing chat kept open',
        should: 'allow summary without closing the remaining conversation',
        actual: f.chats.map((chat) => chat.title),
        expected: ['Atlas planning'],
      })
      if (shots) await page.screenshot({ path: path.join(shots, 'summary-phone.png'), fullPage: true })
      await dialog.getByRole('button', { name: 'Back', exact: true }).click()
      await dialog.getByRole('heading', { name: 'Keep the conversation going' }).waitFor()
      await dialog.getByRole('button', { name: 'Back', exact: true }).click()
      await dialog.locator('summary', { hasText: '1 handled or skipped' }).click()
      await dialog.getByRole('button', { name: 'Review again' }).click()
      await dialog.getByRole('button', { name: 'Import notes' }).waitFor()
      await dialog.getByRole('button', { name: 'Skip this step' }).click()
      await dialog.getByRole('heading', { name: 'Keep the conversation going' }).waitFor()
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await dialog.getByRole('button', { name: 'Read summary' }).waitFor()
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
      await page.waitForFunction((day) => document.title === `sky · Review ${day} · Summary`, REVIEW_DAY)
      await dialog.getByRole('button', { name: 'Close for now' }).click()
      await page.waitForFunction(() => !document.title.includes('Review'))
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)

test(
  {
    name: 'morning review shows in every open tab until the person acts on it in one of them',
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
      const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
      await context.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      const pauses: string[] = []
      context.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith(`/${REVIEW_DAY}/close`)) pauses.push(request.url())
      })
      const tab = async () => {
        const page = await context.newPage()
        page.setDefaultTimeout(15000)
        const status = page.waitForResponse((response) => response.url().endsWith('/day-review/_api/status'))
        await page.goto(origin)
        return {
          page,
          pending: ((await (await status).json()) as { pending: string | null }).pending,
          dialog: page.getByRole('dialog', { name: `Review ${REVIEW_DAY}` }),
        }
      }
      await f.idle.sample(0, 0, REVIEW_DAY, REVIEW_DAY, 5)
      await f.idle.sample(6 * 3_600_000, 0, REVIEW_DAY, REVIEW_TODAY, 5)
      const first = await tab()
      await first.dialog.waitFor()
      const second = await tab()
      await second.dialog.waitFor()
      await first.page.bringToFront()
      await first.page.reload()
      await first.dialog.waitFor()
      await second.page.bringToFront()
      const acknowledged = second.page.waitForResponse((response) =>
        response.url().endsWith(`/${REVIEW_DAY}/acknowledge`),
      )
      await second.dialog.getByRole('button', { name: 'Skip this step' }).click()
      await acknowledged
      await second.dialog.getByRole('heading', { name: 'Did you do these?' }).waitFor()
      await first.page.bringToFront()
      await first.page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await first.dialog.waitFor({ state: 'detached' })
      const later = await tab()
      assert({
        given: 'the review shown in two tabs, one reloaded, then a choice made in the other',
        should:
          'keep it where the person acted, withdraw it elsewhere without pausing it, and not show it in a new tab',
        actual: [
          new URL(second.page.url()).searchParams.get('review'),
          await second.dialog.count(),
          pauses,
          (await f.view()).paused,
          later.pending,
          await later.dialog.count(),
        ],
        expected: [REVIEW_DAY, 1, [], false, null, 0],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await f.dispose()
    }
  },
)
