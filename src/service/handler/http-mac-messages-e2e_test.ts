import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { TRANSCRIPTION_MODELS } from '#commands/all/audio/transcript/lib/models.ts'
import type { MacMessagesStatus } from '#lib/macMessages/mod.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { type ConnectionsHost, createConnectionsRoutes } from './settings/connections.ts'
import type { SettingsData } from './settings/mod.ts'

/**
 * Messages on this Mac, in a browser over a scripted host: the row under
 * Connections names the binary that needs Full Disk Access and opens the
 * pane, reads again once the grant is there, and Beeper's iMessage card
 * points to it while the names cannot be read. SKY_MAC_MESSAGES_SCREENSHOTS
 * names a folder for captures.
 */

test(
  {
    name: 'The Messages-on-this-Mac row: the grant it needs, the pane it opens, and the iMessage card that points to it',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-mac-messages-page-'))
    await mkdir(path.join(root, 'journal'))
    let mac: MacMessagesStatus = {
      supported: true,
      messages: 'denied',
      contacts: 'denied',
      books: 0,
      names: 0,
      handles: 0,
      binary: '/opt/homebrew/bin/bun',
    }
    let opened = 0
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
        status: () =>
          Promise.resolve({
            running: true,
            version: '4.3.0',
            connected: true,
            accounts: [
              {
                id: 'im1',
                network: 'iMessage',
                status: 'connected',
                save: false,
                groups: false,
                holdUnknown: true,
                chosen: false,
                chats: 0,
              },
            ],
            held: [],
          }),
        connect: () => Promise.resolve(null),
        connection: () => null,
        token: () => Promise.resolve({ ok: false, message: 'no Beeper here' }),
        disconnect: () => Promise.resolve(),
        rule: () => Promise.resolve(true),
        preview: () => Promise.resolve({ rows: [], complete: true }),
        check: () => Promise.resolve({ ran: true as const, chats: 0, messages: 0, files: 0, complete: true }),
        keep: () => Promise.resolve(false),
        open: () => Promise.resolve(true),
      },
      macMessages: {
        status: () => Promise.resolve({ ...mac }),
        openSettings: () => {
          opened += 1
          return Promise.resolve(true)
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
    app.route('/', createTestHttpApp([path.join(root, 'journal')]))
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      const screenshots = env.get('SKY_MAC_MESSAGES_SCREENSHOTS')
      const capture = async (name: string) => {
        if (!screenshots) return
        await page.waitForTimeout(300)
        const height = await page.evaluate(
          () => (document.querySelector('.sky-scroll') as HTMLElement).scrollHeight + 40,
        )
        await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.min(height, 4000) })
        await page.screenshot({ path: path.join(screenshots, `${name}.png`) })
      }

      // The row, with the grant missing: it says what to add where, and opens the pane.
      await page.goto(`${base}/settings/connections`)
      const row = page.locator('.sky-set-row', { hasText: 'Messages on this Mac' }).first()
      await row.getByRole('button', { name: 'Open System Settings' }).waitFor()
      const stateBefore = await row.locator('.sky-set-off').innerText()
      const before = await row.locator('.sky-set-sub').innerText()
      await capture('1-row-needs-grant')
      await row.getByRole('button', { name: 'Open System Settings' }).click()
      await page.waitForFunction(() => true)
      // A check that still finds the grant missing: a running Sky picks a
      // grant up only once it starts again, so the row now offers that.
      const restartBefore = await row.getByRole('button', { name: 'Restart Sky' }).count()
      await row.getByRole('button', { name: 'Check again' }).click()
      await row.getByRole('button', { name: 'Restart Sky' }).waitFor()
      const hint = await row.locator('.sky-set-sub').innerText()
      await capture('1b-row-offers-restart')
      // The person grants it; Check again reads the databases.
      mac = { ...mac, messages: 'readable', contacts: 'readable', books: 2, names: 540, handles: 2450 }
      await row.getByRole('button', { name: 'Check again' }).click()
      await row.locator('.sky-set-status').waitFor()
      const after = await row.locator('.sky-set-sub').innerText()
      await capture('2-row-reading')

      // Beeper's iMessage card, while the grant is missing, points to the row.
      mac = { ...mac, messages: 'denied', contacts: 'denied' }
      await page.goto(`${base}/settings/connections/beeper`)
      const card = page.locator('.sky-block').filter({ has: page.locator('.sky-block-head', { hasText: 'iMessage' }) })
      await card.getByRole('button', { name: 'Fix it under Connections' }).waitFor()
      const warn = await card.locator('.sky-set-warn').innerText()
      await capture('3-imessage-card')
      await card.getByRole('button', { name: 'Fix it under Connections' }).click()
      await page.locator('.sky-set-row', { hasText: 'Messages on this Mac' }).first().waitFor()

      assert({
        given:
          'a Mac whose databases the service may not read, then the grant, then Beeper’s page with the grant missing again',
        should:
          'say which binary needs Full Disk Access and open the pane, offer a restart once a check still finds the grant missing, read once asked again, and point from the iMessage card to the row',
        actual: [
          stateBefore,
          before.includes('/opt/homebrew/bin/bun'),
          before.includes('cannot read this Mac’s Contacts and Messages'),
          opened,
          restartBefore,
          hint.includes('once it starts again'),
          after.includes('540 names'),
          warn.includes('every sender would be held'),
          new URL(page.url()).pathname,
          errors,
        ],
        expected: ['Not reading', true, true, 1, 0, true, true, true, '/settings/connections', []],
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
