import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { planTestHost, samplePlan } from './chat/planTestHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'live plan stays anchored and usable on desktop and mobile through handoff, pause, and reload',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-chat-plan-e2e-'))
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
    app.get('/settings/_api/writing-voice/edits', (c) => c.json({ edits: [] }))
    app.route(
      '/',
      createTestHttpApp([root], {
        chat: planTestHost(root, async (plan, { sink, abortSignal, messages }) => {
          if (JSON.stringify(messages.at(-1)).includes('Check for duplicate documents first.')) {
            sink.write('The example documents contain no duplicates.')
            return
          }
          if (JSON.stringify(messages).includes('What is two plus two?')) {
            sink.write('Four.')
            return
          }
          if (!plan.plan) await plan.update(samplePlan())
          sink.write(
            'I have confirmed the example sources.\n\nI will keep the checklist updated as I collect the documents.',
          )
          await plan.wait('Finish sign-in to the example provider on the computer running Sky.', 'browser', abortSignal)
          if (!abortSignal?.aborted) {
            await new Promise<void>((resolve) =>
              abortSignal!.addEventListener('abort', () => resolve(), { once: true }),
            )
          }
        }),
      }),
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/thread/plan-example`)
      await page.locator('.sky-composer textarea').fill('Collect the example documents.')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await page.getByRole('complementary', { name: 'Plan', exact: true }).waitFor()
      await page.locator('.sky-plan-attention').getByText('Needs you', { exact: true }).waitFor()
      const view = page.getByRole('button', { name: 'View plan' })
      const outcome = samplePlan().outcome
      const detail = samplePlan().steps[0]!.detail
      assert({
        given: 'a desktop plan opened for the first time',
        should: 'show checklist titles and progress with its longer descriptions collapsed',
        actual: [
          await page.getByText(outcome, { exact: true }).count(),
          await page.getByText(detail, { exact: true }).count(),
          await page.getByRole('button', { name: 'Show details', exact: true }).isVisible(),
          await page.locator('.sky-plan-intro [role="progressbar"]').isVisible(),
        ],
        expected: [0, 0, true, true],
      })
      await page.getByRole('button', { name: 'Show details', exact: true }).click()
      await page.getByText(detail, { exact: true }).waitFor()
      await page.waitForTimeout(1200)
      assert({
        given: 'explicitly expanded details across a background refresh',
        should: 'keep the notes accessible and preserve the expansion',
        actual: [
          await page.getByText(outcome, { exact: true }).isVisible(),
          await page.getByRole('button', { name: 'Hide details', exact: true }).getAttribute('aria-expanded'),
        ],
        expected: [true, 'true'],
      })
      await page.getByRole('button', { name: 'Hide details', exact: true }).click()
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
      assert({
        given: 'a desktop task needing a browser handoff',
        should: 'show its checklist and an explicit anchored entry point',
        actual: [
          await view.isVisible(),
          await page.locator('.sky-plan-steps > li').count(),
          Math.abs(
            (await page.locator('.sky-plan-bar').boundingBox())!.y -
              ((await page.locator('.sky-chat-head').boundingBox())!.y +
                (await page.locator('.sky-chat-head').boundingBox())!.height),
          ) < 2,
        ],
        expected: [true, 3, true],
      })
      await page.locator('.sky-composer textarea').fill('Check for duplicate documents first.')
      await page.getByRole('button', { name: 'Send instruction', exact: true }).click()
      await page.locator('.sky-plan-queue-note').waitFor()
      assert({
        given: 'a new instruction during a browser handoff',
        should: 'accept it visibly and preserve the current work',
        actual: [
          await page.locator('.sky-composer textarea').inputValue(),
          (await page.locator('.sky-plan-queue-note').innerText()).includes('1 instruction waiting'),
        ],
        expected: ['', true],
      })
      await page.getByRole('button', { name: 'Chat', exact: true }).click()
      await page.locator('.sky-composer textarea').fill('What is two plus two?')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await page.getByText('Four.', { exact: true }).waitFor()
      assert({
        given: 'a second chat while the original task is waiting',
        should: 'answer independently without creating a checklist',
        actual: [await view.count(), (await page.title()).includes('What is two plus two')],
        expected: [0, true],
      })
      await page.goBack()
      await page.getByRole('complementary', { name: 'Plan', exact: true }).waitFor()
      assert({
        given: 'back navigation to the running task',
        should: 'restore its title, handoff and queued instruction',
        actual: [
          (await page.title()).includes('Collect the example documents'),
          await page.locator('.sky-plan-queue-note').count(),
          (await page.locator('.sky-plan-bar').innerText()).includes('Needs you'),
        ],
        expected: [true, 1, true],
      })
      await page.getByRole('button', { name: 'Close plan', exact: true }).click()
      await page.reload()
      await view.waitFor()
      assert({
        given: 'a closed plan after reload',
        should: 'respect the dismissal while showing Needs you',
        actual: [
          await page.locator('.sky-plan-panel').count(),
          (await page.locator('.sky-plan-bar').innerText()).includes('Needs you'),
          await view.isVisible(),
        ],
        expected: [0, true, true],
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await view.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert({
        given: 'the phone plan drawer',
        should: 'start compact and keep sign-in help visible',
        actual: [
          await dialog.getByText(outcome, { exact: true }).count(),
          await dialog.getByText(detail, { exact: true }).count(),
          await dialog.getByRole('button', { name: 'Show details', exact: true }).isVisible(),
          await dialog.locator('.sky-plan-attention').isVisible(),
        ],
        expected: [0, 0, true, true],
      })
      await dialog.getByRole('button', { name: 'Show details', exact: true }).click()
      await dialog.getByText(detail, { exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'Hide details', exact: true }).click()
      await dialog.getByRole('button', { name: 'I’ve finished — continue', exact: true }).click()
      await dialog.getByRole('button', { name: 'Pause', exact: true }).click()
      await dialog.getByRole('button', { name: 'Resume', exact: true }).waitFor()
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-mobile-plan.png'), fullPage: true })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert({
        given: 'a dismissed phone drawer after pausing',
        should: 'keep View plan near the top, preserve chat, and avoid horizontal overflow',
        actual: [
          (await view.boundingBox())!.y < 260,
          await page
            .locator('.sky-plan-bar')
            .innerText()
            .then((text) => text.includes('Paused')),
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        ],
        expected: [true, true, false],
      })
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-mobile-chat.png'), fullPage: true })
      // Polling the persisted plan must not replace unchanged chat text nodes.
      await page
        .locator('.sky-body p')
        .first()
        .evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
        })
      const selected = await page.evaluate(() => window.getSelection()?.toString())
      await page.waitForTimeout(2400)
      assert({
        given: 'a background plan refresh',
        should: 'preserve selected text and a meaningful browser title',
        actual: [
          await page.evaluate(() => window.getSelection()?.toString()),
          (await page.title()).includes('Collect the example documents'),
          errors,
        ],
        expected: [selected, true, []],
      })
      await page.setViewportSize({ width: 320, height: 700 })
      await view.click()
      await dialog.waitFor()
      assert({
        given: 'a small phone',
        should: 'keep the drawer controls within the viewport',
        actual: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        expected: true,
      })
      await dialog.getByRole('button', { name: 'Send now', exact: true }).click()
      await page.keyboard.press('Escape')
      await page.getByText('The example documents contain no duplicates.', { exact: true }).waitFor()
      await page.locator('.sky-plan-queue-note').waitFor({ state: 'hidden' })
      const delivered = await (await app.request('/chat/plan-example')).json()
      assert({
        given: 'Send now on an instruction held by Pause, on a phone',
        should: 'deliver it once, clear its queue notice, and keep the plan paused and the title specific',
        actual: [
          delivered.plan.status,
          delivered.queued,
          (await page.title()).includes('Collect the example documents'),
          errors,
        ],
        expected: ['paused', [], true, []],
      })
    } finally {
      await app.request('/chat/plan-example/stop', { method: 'POST' })
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
