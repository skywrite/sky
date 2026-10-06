import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { planTestHost, samplePlan } from './chat/planTestHelpers.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'failed replies remain visible through plan polling, refresh and service recovery',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-chat-failure-e2e-'))
    const failure = 'The example provider could not finish this reply.'
    const makeApp = (recovered?: Awaited<ReturnType<typeof loadResumeSession>>) => {
      const app = new Hono()
      app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
      app.get('/settings/_api/writing-voice/edits', (c) => c.json({ edits: [] }))
      app.route(
        '/',
        createTestHttpApp([root], {
          chat: planTestHost(
            root,
            async (plan, { sink }) => {
              if (recovered) {
                sink.write('The example reply recovered.')
                return
              }
              if (!plan.plan) await plan.update(samplePlan())
              sink.write('The example receipt is recorded.')
              throw new Error(failure)
            },
            recovered
              ? async () => [
                  {
                    id: 'failure-example',
                    startTime: new PlainDateTime('2026-01-27 09:30'),
                    state: recovered.state,
                    plan: recovered.recovery?.host?.plan,
                  },
                ]
              : undefined,
          ),
        }),
      )
      return app
    }
    let app = makeApp()
    const server = serve({ fetch: (request, ...rest) => app.fetch(request, ...rest), hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${address.port}/thread/failure-example`)
      await page.locator('.sky-composer textarea').fill('Collect example documents.')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const alert = page.getByRole('alert').filter({ hasText: failure })
      await alert.waitFor()
      let polls = 0
      page.on('response', (response) => {
        if (new URL(response.url()).pathname === '/chat/failure-example') polls++
      })
      for (let i = 0; i < 4; i++)
        await page.waitForResponse((response) => new URL(response.url()).pathname === '/chat/failure-example')
      assert({
        given: 'a failed turn in a chat with a persisted plan',
        should: 'keep its error, partial answer, retry action and specific page title through background refreshes',
        actual: [
          await alert.isVisible(),
          await page.getByText('The example receipt is recorded.', { exact: true }).isVisible(),
          await page.getByRole('button', { name: 'Retry reply' }).isVisible(),
          polls >= 4,
          (await page.title()).includes('Collect example documents'),
        ],
        expected: [true, true, true, true, true],
      })
      await page.reload()
      await alert.waitFor()
      const saved = await loadResumeSession(path.join(root, 'failure-example.md'), { snapshot: true })
      app = makeApp(saved)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.reload()
      await alert.waitFor()
      assert({
        given: 'a fresh host restored from disk and the mobile view',
        should: 'show the same failure and preserved partial answer',
        actual: [
          await alert.isVisible(),
          await page.getByText('The example receipt is recorded.', { exact: true }).isVisible(),
          saved.state.conversation.at(-1)?.error,
        ],
        expected: [true, true, failure],
      })
      await page.getByRole('button', { name: 'Retry reply' }).click()
      await page.getByText('The example reply recovered.', { exact: true }).waitFor()
      assert({
        given: 'retry after restart',
        should: 'continue in the same chat while preserving its prior failure',
        actual: [await alert.isVisible(), await page.getByRole('button', { name: 'Retry reply' }).count()],
        expected: [true, 0],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
