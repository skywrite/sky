import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { TRANSCRIPTION_MODELS } from '#commands/all/audio/transcript/lib/models.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { type ConnectionsHost, createConnectionsRoutes, type NotionStatus } from './settings/connections.ts'
import type { SettingsData } from './settings/mod.ts'

/**
 * Notion under Connections, in a browser over a scripted host: the row's
 * Connect opens Notion's approval page in a tab, the row turns connected
 * when the sign-in lands, it leads to Notion's own page, which says who is
 * signed in and disconnects, and every step keeps a title naming the screen.
 * SKY_NOTION_SCREENSHOTS names a folder for captures.
 */

test(
  {
    name: 'The Notion connection: one click to connect, its own page, and Disconnect',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-notion-page-'))
    await mkdir(path.join(root, 'journal'))
    let base = ''
    let approved = false
    let connected = false
    const status = (): NotionStatus =>
      connected
        ? { connected: true, workspace: 'Atlas', user: 'Jane Doe', email: 'jane@example.com' }
        : { connected: false }
    const host: ConnectionsHost = {
      secrets: new TestSecretsProvider({}),
      providers: () => [],
      google: {
        connect: () => Promise.resolve(null),
        connection: () => null,
        setup: { start: () => null, state: () => null, continue: () => false, cancel: () => false },
      },
      slack: {
        status: () => Promise.resolve({ installed: false }),
        reconnect: () => Promise.resolve({ installed: false }),
      },
      beeper: {
        status: () => Promise.resolve({ running: false, connected: false, accounts: [], held: [] }),
        connect: () => Promise.resolve(null),
        connection: () => null,
        token: () => Promise.resolve({ ok: false, message: 'no Beeper here' }),
        disconnect: () => Promise.resolve(),
        rule: () => Promise.resolve(false),
        preview: () => Promise.resolve(null),
        check: () => Promise.resolve({ ran: false as const, reason: 'no Beeper here' }),
        keep: () => Promise.resolve(false),
        open: () => Promise.resolve(null),
      },
      notion: {
        status: () => Promise.resolve(status()),
        connect: () => Promise.resolve({ id: 'n1', url: `${base}/notion-approval` }),
        connection: (id) => {
          if (id !== 'n1') return null
          if (!approved) return { status: 'waiting' }
          connected = true
          return { status: 'done', workspace: 'Atlas' }
        },
        disconnect: () => {
          connected = false
          return Promise.resolve()
        },
      },
      typesafe: {
        status: () => Promise.resolve({ connected: false, models: [] }),
        key: () => Promise.resolve({ ok: false, message: 'no TypeSafe here' }),
        disconnect: () => Promise.resolve(),
      },
    }
    const settings: SettingsData = {
      transcription: {
        value: 'openai/gpt-transcribe',
        choices: TRANSCRIPTION_MODELS.map((model) => ({ ...model, configured: model.provider === 'openai' })),
      },
      calendar: { classifyEvents: false },
      theme: 'light',
      experimental: { contextPreflight: false, workstreams: false },
      textSize: 'default',
      voice: { current: 'marin', groups: { male: ['ash'], female: ['marin'] } },
      models: [],
      profiles: [],
      writingVoice: { profile: 'sample', choices: [] },
      providers: [],
      memoryNotes: 0,
      notebook: {
        dir: '/Notebook',
        userDataDir: '/Notebook-Data',
        inputDir: '/Input',
        outputDir: '/Output',
        editor: 'code',
        editors: ['code'],
      },
      about: { version: 'sample', date: '2026-01-15' },
      advanced: { path: '/Config/config.jsonc', exists: true, version: 1, sections: [] },
    }
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json(settings))
    app.route('/settings/_api/connections', createConnectionsRoutes(host))
    // Stands in for Notion's approval page: opening it is the person allowing Sky.
    app.get('/notion-approval', (c) => {
      approved = true
      return c.html('<!doctype html><title>Notion</title><p>Allow Sky to access your workspace?</p>')
    })
    app.route('/', createTestHttpApp([path.join(root, 'journal')]))
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    base = `http://127.0.0.1:${address.port}`
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const screenshots = env.get('SKY_NOTION_SCREENSHOTS')
      const capture = async (name: string) => {
        if (!screenshots) return
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(screenshots, `${name}.png`) })
      }
      const notionRow = page.locator('.sky-set-row', { hasText: 'Notion' }).first()

      await page.goto(`${base}/settings/connections`)
      await notionRow.getByRole('button', { name: 'Connect Notion' }).waitFor()
      const before = [await notionRow.locator('.sky-set-sub').innerText(), await page.title()]
      await capture('1-connections-not-connected')

      const opened = context.waitForEvent('page')
      await notionRow.getByRole('button', { name: 'Connect Notion' }).click()
      const tab = await opened
      await tab.waitForURL(`${base}/notion-approval`)
      await notionRow.getByRole('button', { name: 'Notion settings' }).waitFor()
      const after = [
        await notionRow.locator('.sky-set-sub').innerText(),
        await notionRow.locator('.sky-set-status').innerText(),
      ]
      await tab.close()
      await capture('2-connections-connected')

      await notionRow.getByRole('button', { name: 'Notion settings' }).click()
      await page.getByRole('heading', { name: 'Notion', exact: true }).waitFor()
      await page.locator('.sky-block-head', { hasText: 'In a chat' }).waitFor()
      const own = [
        new URL(page.url()).pathname,
        await page.title(),
        await page.locator('.sky-set-row', { hasText: 'Atlas' }).locator('.sky-set-sub').innerText(),
      ]
      await capture('3-notion-page')

      await page.goBack()
      await notionRow.getByRole('button', { name: 'Notion settings' }).waitFor()
      const back = await page.title()
      await page.goForward()
      await page.getByRole('heading', { name: 'Notion', exact: true }).waitFor()
      const forward = await page.title()

      await page.getByRole('button', { name: 'Disconnect' }).click()
      await page.getByRole('status').filter({ hasText: 'Disconnected' }).waitFor()
      await page.getByRole('button', { name: 'Connect Notion' }).waitFor()
      const disconnected = [
        await page.getByRole('status').filter({ hasText: 'Disconnected' }).innerText(),
        await page.locator('.sky-block-head', { hasText: 'In a chat' }).count(),
      ]
      await capture('4-notion-disconnected')

      await page.setViewportSize({ width: 390, height: 900 })
      await page.goto(`${base}/settings/connections/notion`)
      await page.getByRole('button', { name: 'Connect Notion' }).waitFor()
      const direct = [
        await page.title(),
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      ]
      await capture('5-notion-phone')

      assert({
        given: 'the Notion connection over a scripted host, in a browser',
        should:
          'connect from the row in one click, lead to its own page, disconnect there, and keep the title on every screen',
        actual: { before, after, own, back, forward, disconnected, direct, errors },
        expected: {
          before: [
            'Find, read and create Notion pages in chats. Notion asks you to allow Sky, and that is all.',
            'sky · Connections',
          ],
          after: ['Atlas · signed in as Jane Doe\n\nConnected to Atlas.', 'Connected'],
          own: ['/settings/connections/notion', 'sky · Notion', 'Signed in as Jane Doe (jane@example.com)'],
          back: 'sky · Connections',
          forward: 'sky · Notion',
          disconnected: ['Disconnected. Sky signed out of Notion on this Mac.', 0],
          direct: ['sky · Notion', false],
          errors: [],
        },
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
