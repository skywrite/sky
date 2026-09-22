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
    name: 'Every chat tool shows progress through waiting, execution, and completion',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-tool-progress-'))
    const runs: ToolRun[] = []
    let busy = true
    for (const name of ['future_tool', 'hosted_lookup', 'failing_tool']) {
      recordToolExecution(runs, 1, {
        type: 'tool-execution-start',
        toolCallId: name,
        toolName: name,
        phase: 'preparing',
        started: new ZonedDateTime().epochMilliseconds - 65000,
      })
    }
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
    app.get('/settings/_api/writing-voice/edits', (c) => c.json({ edits: [] }))
    app.get('/chat/progress', (c) =>
      c.json({
        turns: [
          { role: 'user', content: 'Run the sample tools.' },
          { role: 'assistant', content: 'Checking.' },
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
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/thread/progress`)
      await page.getByRole('progressbar', { name: 'future tool progress' }).waitFor()
      const first = page.getByRole('button', { name: 'Future Tool details', exact: true })
      const initial = await first.textContent()
      await page.waitForFunction(
        (before) => document.querySelector('[aria-label="Future Tool details"]')?.textContent !== before,
        initial,
      )
      assert({
        given: 'three previously unknown tools running for more than a minute',
        should: 'show an indicator for each and keep the elapsed seconds ticking',
        actual: [
          await page.getByRole('progressbar').count(),
          /\d+m \d+s/.test((await first.textContent())!) || (await first.textContent()),
        ],
        expected: [3, true],
      })
      recordToolExecution(runs, 1, {
        type: 'tool-execution-start',
        toolCallId: 'future_tool',
        toolName: 'future_tool',
        phase: 'waiting',
        input: { task: 'Read the sample.' },
        started: new ZonedDateTime().epochMilliseconds,
      })
      await first.getByText('Waiting for approval', { exact: true }).waitFor()
      recordToolExecution(runs, 1, {
        type: 'tool-execution-start',
        toolCallId: 'future_tool',
        toolName: 'future_tool',
        phase: 'running',
        started: new ZonedDateTime().epochMilliseconds,
      })
      await first.getByText('Running', { exact: true }).waitFor()
      for (const run of runs)
        recordToolExecution(runs, 1, {
          type: 'tool-execution-end',
          toolCallId: run.callId!,
          toolName: run.tool,
          finished: new ZonedDateTime().epochMilliseconds,
          ...(run.tool === 'failing_tool' ? { error: 'Test connection lost.' } : { output: { success: true } }),
        })
      busy = false
      await page.getByRole('button', { name: /Tools · 3/ }).click()
      await first.getByText('Completed', { exact: true }).waitFor()
      await page
        .getByRole('button', { name: 'Failing Tool details', exact: true })
        .getByText('Failed', { exact: true })
        .waitFor()
      assert({
        given: 'successful and failed tools after the next refresh',
        should: 'stop every indicator with no browser errors',
        actual: [await page.getByRole('progressbar').count(), errors],
        expected: [0, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
