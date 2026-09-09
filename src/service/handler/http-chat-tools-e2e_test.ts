import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ToolRun } from './chat/mod.ts'
import { recordToolExecution } from './chat/toolRuns.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'Tool details stay inspectable through progress, completion, reload, and a second failed call',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-tool-inspector-'))
    const runs: ToolRun[] = []
    const stamp = new ZonedDateTime().epochMilliseconds
    let busy = true
    const input = {
      action: 'draft',
      meaning: 'Ask for the revised draft.',
      medium: 'Email',
      recipient: 'Jane Doe',
      context: 'A familiar colleague. Keep <script> as plain text.',
      instruction: 'Keep it brief.',
    }
    recordToolExecution(runs, 1, {
      type: 'tool-execution-start',
      phase: 'preparing',
      toolName: 'me_voice',
      toolCallId: 'first',
      started: stamp,
    })
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
    app.get('/settings/_api/writing-voice/examples', (c) => c.json({ examples: [] }))
    app.get('/chat/tool-inspector', (c) =>
      c.json({
        turns: [
          { role: 'user', content: 'Draft an update.' },
          { role: 'assistant', content: busy ? 'I will draft it.' : 'Here is the draft.' },
        ],
        documents: 0,
        kept: 0,
        busy,
        runs,
      }),
    )
    app.route('/', createTestHttpApp([root]))
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/thread/tool-inspector`)
      const details = page.getByRole('button', { name: 'Me Voice details', exact: true }).first()
      await details.click()
      await page.getByText('The model is preparing the tool inputs.', { exact: true }).waitFor()
      recordToolExecution(runs, 1, {
        type: 'tool-execution-start',
        phase: 'running',
        toolName: 'me_voice',
        toolCallId: 'first',
        started: stamp + 1000,
        input,
      })
      await page.getByText('A familiar colleague. Keep <script> as plain text.', { exact: false }).waitFor()
      const shown = await page.locator('.sky-tool-details pre').first().textContent()
      const selected = await page.evaluate(() => {
        const pre = document.querySelector('.sky-tool-details pre')!
        const range = document.createRange()
        range.selectNodeContents(pre)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        return selection.toString()
      })
      await page.waitForResponse((response) => response.url().endsWith('/chat/tool-inspector'))
      assert({
        given: 'an expanded input while the tool and page keep updating',
        should: 'show every parameter as plain text and preserve selection through polling',
        actual: [JSON.parse(shown!), await page.evaluate(() => window.getSelection()?.toString())],
        expected: [input, selected],
      })
      recordToolExecution(runs, 1, {
        type: 'tool-execution-end',
        toolName: 'me_voice',
        toolCallId: 'first',
        output: { success: true, draft: 'Hey, can you send the revised draft? Thanks.' },
        finished: stamp + 9000,
      })
      busy = false
      await page.getByText('Result', { exact: true }).waitFor()
      assert({
        given: 'completion while the input inspector is open',
        should: 'keep it open with the result and the existing text selection',
        actual: [
          await details.getAttribute('aria-expanded'),
          await page.evaluate(() => window.getSelection()?.toString()),
        ],
        expected: ['true', selected],
      })
      await page.reload()
      await details.click()
      await page.getByText('Result', { exact: true }).waitFor()
      recordToolExecution(runs, 1, {
        type: 'tool-execution-start',
        phase: 'running',
        toolName: 'me_voice',
        toolCallId: 'second',
        input: { meaning: 'Another draft.' },
        started: stamp + 10000,
      })
      recordToolExecution(runs, 1, {
        type: 'tool-execution-end',
        toolName: 'me_voice',
        toolCallId: 'second',
        error: 'The test model timed out.',
        finished: stamp + 12000,
      })
      await page.reload()
      const second = page.getByRole('button', { name: 'Me Voice details', exact: true }).nth(1)
      await second.click()
      await page.getByRole('alert').filter({ hasText: 'The test model timed out.' }).waitFor()
      await details.click()
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      assert({
        given: 'two calls of the same tool on a phone-sized screen',
        should: 'keep separate results and fit the screen without browser errors',
        actual: [
          await page.getByRole('button', { name: 'Me Voice details', exact: true }).count(),
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          errors,
        ],
        expected: [2, false, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
