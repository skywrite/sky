import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'The composer arrow stops generation in place, including after reload and on mobile',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-chat-stop-'))
    const signals: AbortSignal[] = []
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
    app.get('/settings/_api/writing-voice/examples', (c) => c.json({ examples: [] }))
    app.route(
      '/',
      createTestHttpApp([root], {
        chat: {
          timeDir: path.join(root, 'time'),
          settings: {
            defaultModel: 'test',
            defaultContextTokens: 0,
            choices: () => [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
            resolve: () => ({ model: {} as ResolvedModel, profile: { model: 'test' } }),
          },
          createSession: async (_id, onEvent) =>
            new ChatSession({
              today: new PlainDate('2026-01-27'),
              startTime: new PlainDateTime('2026-01-27 09:30'),
              days: 0,
              baseDir: root,
              timeDir: path.join(root, 'time'),
              contextTokens: 0,
              resume: null,
              model: {} as ResolvedModel,
              profile: { model: 'test' },
              ambient: { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] },
              producers: {
                produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
                evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
                executeQuery: async () => ({ ok: true, value: { paths: [] } }),
              },
              systemPrompt: async () => 'Test assistant.',
              tools: async () => ({ tools: {}, toolApproval: {} }),
              approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
              autosavePath: null,
              onEvent,
              now: async () => new PlainDateTime('2026-01-27 09:31'),
              logError: async () => {},
              invokeModel: async ({ sink, abortSignal }) => {
                signals.push(abortSignal!)
                sink.write('The partial answer stays here.')
                await new Promise<void>((resolve) =>
                  abortSignal!.addEventListener('abort', () => resolve(), { once: true }),
                )
                return { text: '', content: [], steps: [], responseMessages: [] }
              },
            }),
        },
      }),
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/thread/stop-test`)
      const composer = page.locator('.sky-composer-shell')
      const input = composer.locator('textarea')
      const send = composer.getByRole('button', { name: 'Send', exact: true })
      const stop = composer.getByRole('button', { name: 'Stop response', exact: true })
      await input.fill('Start a long answer.')
      const sendBox = await send.boundingBox()
      await send.click()
      await page.getByText('The partial answer stays here.', { exact: true }).waitFor()
      const stopBox = await stop.boundingBox()
      assert({
        given: 'an active reply',
        should: 'replace the composer arrow with a square in the same position',
        actual: [
          Math.abs(sendBox!.x - stopBox!.x) < 1,
          Math.abs(sendBox!.y - stopBox!.y) < 1,
          await stop.locator('svg rect').count(),
          await send.count(),
        ],
        expected: [true, true, 1, 0],
      })
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
      await page.route('**/chat/stop-test/stop', (route) => route.fulfill({ status: 503, body: '{}' }), { times: 1 })
      await stop.click()
      await page.getByRole('alert').filter({ hasText: 'Could not stop the response.' }).waitFor()
      await stop.click()
      await page.getByText('Response stopped.', { exact: true }).waitFor()
      await send.waitFor()
      assert({
        given: 'a failed stop request followed by retry',
        should: 'abort the server turn without losing the reply or treating it as a restart',
        actual: [
          signals[0].aborted,
          await page.getByText('The partial answer stays here.', { exact: true }).count(),
          await input.isEnabled(),
          await page.getByText('sky is restarting', { exact: false }).count(),
        ],
        expected: [true, 1, true, 0],
      })
      await input.fill('A second question.')
      await send.click()
      await stop.waitFor()
      await page.getByText('The partial answer stays here.', { exact: true }).nth(1).waitFor()
      await page.reload()
      await stop.waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      assert({
        given: 'a reloaded active chat on a phone',
        should: 'keep Stop available inside the text box without horizontal overflow',
        actual: [
          await stop.isEnabled(),
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        ],
        expected: [true, false],
      })
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-mobile.png'), fullPage: true })
      await stop.click()
      await send.waitFor()
      await page.getByText('Response stopped.', { exact: true }).nth(1).waitFor()
      assert({
        given: 'Stop after a reload',
        should: 'cancel the same server turn and leave no browser errors',
        actual: [signals.length, signals.every((signal) => signal.aborted), errors],
        expected: [2, true, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
