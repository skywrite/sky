import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { jsonSchema, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

const LOOKUPS = 30
const ANSWER = 'All thirty Atlas records agree on the March demo.'
const LINE = '— compacted to make room · cleared 9 older tool results —'
const NOTE = 'Sky can look up anything it cleared, and your messages and its replies are unchanged.'

function step(parts: unknown[], unified: 'tool-calls' | 'stop') {
  return {
    stream: simulateReadableStream<any>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...parts,
        {
          type: 'finish',
          finishReason: { unified, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ],
    }),
  }
}

test(
  {
    name: 'A chat that reaches the model’s limit shows that it was compacted, while the reply is written and after a reload',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-chat-compaction-'))
    // The answer waits until the page has shown the compaction, so the test sees it during the reply.
    let answer = () => {}
    const seen = new Promise<void>((resolve) => (answer = resolve))
    const model = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        const done = prompt.filter((message) => message.role === 'tool').length
        if (done < LOOKUPS)
          return step(
            [
              {
                type: 'tool-call',
                toolCallId: `lookup-${done}`,
                toolName: 'lookup',
                input: JSON.stringify({ id: done }),
              },
            ],
            'tool-calls',
          )
        await seen
        return step(
          [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: ANSWER },
            { type: 'text-end', id: 't' },
          ],
          'stop',
        )
      },
    })
    // A window the twenty-seventh result overfills: the nine oldest give way, which leaves a quarter of it free.
    const resolved = { model, contextWindow: 102_000 } as ResolvedModel
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json({ theme: 'light', textSize: 'default' }))
    app.get('/settings/_api/writing-voice/edits', (c) => c.json({ edits: [] }))
    app.route(
      '/',
      createTestHttpApp([root], {
        chat: {
          timeDir: path.join(root, 'time'),
          settings: {
            defaultModel: 'test',
            defaultContextTokens: 0,
            choices: () => [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
            resolve: () => ({ model: resolved, profile: { model: 'test' } }),
          },
          createSession: async (_id, onEvent) =>
            new ChatSession({
              today: new PlainDate('2026-01-27'),
              startTime: new PlainDateTime('2026-01-27 09:30'),
              days: 0,
              baseDir: root,
              timeDir: path.join(root, 'time'),
              chatLogDir: path.join(root, 'state', 'logs'),
              contextTokens: 0,
              resume: null,
              model: resolved,
              profile: { model: 'test' },
              ambient: { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] },
              producers: {
                produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
                evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
                executeQuery: async () => ({ ok: true, value: { paths: [] } }),
              },
              systemPrompt: async () => 'Test assistant.',
              tools: async () => ({
                tools: {
                  lookup: {
                    description: 'Look up one Atlas record.',
                    inputSchema: jsonSchema<{ id: number }>({
                      type: 'object',
                      properties: { id: { type: 'number' } },
                      required: ['id'],
                    }),
                    execute: async ({ id }: { id: number }) =>
                      `Atlas record ${id}: ${'the March demo is on schedule. '.repeat(170)}`.slice(0, 5000),
                  },
                },
                toolApproval: {},
              }),
              approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
              autosavePath: null,
              onEvent,
              now: async () => new PlainDateTime('2026-01-27 09:31'),
              logError: async () => {},
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
      await page.goto(`http://127.0.0.1:${address.port}/thread/compaction-test`)
      const composer = page.locator('.sky-composer-shell')
      await composer.locator('[role="textbox"]').fill('Look up all thirty Atlas records.')
      await composer.getByRole('button', { name: 'Send', exact: true }).click()

      const line = page.getByRole('status').filter({ hasText: 'compacted to make room' })
      await line.waitFor()
      // Thirty tool calls scroll the top of the reply away. The line has to be where the page is looking.
      const inView = await page
        .waitForFunction(
          (element) => {
            const box = element!.getBoundingClientRect()
            return box.top >= 0 && box.bottom <= window.innerHeight
          },
          await line.elementHandle(),
          { timeout: 5000 },
        )
        .then(
          () => true,
          () => false,
        )
      const during = {
        inView,
        line: await line.innerText(),
        answered: await page.getByText(ANSWER, { exact: true }).count(),
        stopOffered: await composer.getByRole('button', { name: 'Stop response', exact: true }).count(),
      }
      const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-during.png') })
      answer()
      await page.getByText(ANSWER, { exact: true }).waitFor()
      await composer.getByRole('button', { name: 'Send', exact: true }).waitFor()
      assert({
        given:
          'a reply whose thirty tool results overfill the model, seen while it is still being written and once it is done',
        should:
          'show the compaction line in view while the reply is written, then once above the finished reply, with what it means under it',
        actual: {
          during,
          lines: await line.count(),
          line: await line.innerText(),
          note: await page.getByText(NOTE, { exact: true }).count(),
        },
        expected: {
          during: { inView: true, line: LINE, answered: 0, stopOffered: 1 },
          lines: 1,
          line: LINE,
          note: 1,
        },
      })
      if (screenshot) await page.screenshot({ path: screenshot })

      await page.reload()
      await page.getByText(ANSWER, { exact: true }).waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      assert({
        given: 'the same chat reloaded on a phone',
        should: 'still show where it was compacted, without horizontal overflow or browser errors',
        actual: {
          line: await line.innerText(),
          note: await page.getByText(NOTE, { exact: true }).count(),
          overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          errors,
        },
        expected: { line: LINE, note: 1, overflow: false, errors: [] },
      })
      if (screenshot) await page.screenshot({ path: screenshot.replace('.png', '-mobile.png') })
    } finally {
      answer()
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
