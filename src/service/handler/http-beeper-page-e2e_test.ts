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
import { type BeeperStatus, type ConnectionsHost, createConnectionsRoutes } from './settings/connections.ts'
import type { SettingsData } from './settings/mod.ts'

/**
 * Beeper's page under Connections, in a browser over a scripted host: the
 * row leads there, each network has its switch, a switch writes the rule and
 * the row's summary follows, the last check reads back, and the preview shows
 * what a check would do. SKY_BEEPER_SCREENSHOTS names a folder for captures.
 */

test(
  {
    name: 'The Beeper page: per-network switches, the last check, and the preview',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-page-'))
    await mkdir(path.join(root, 'journal'))
    const accounts: BeeperStatus['accounts'] = [
      {
        id: 'sg1',
        network: 'Signal',
        status: 'connected',
        save: true,
        groups: true,
        holdUnknown: false,
        chosen: true,
        chats: 12,
      },
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
    ]
    const held = [
      {
        chat: '!held1',
        network: 'iMessage',
        who: '+1 (555) 010-2277',
        first: 'Hi, this is Dana with the Atlas campaign. Can we count on you?',
        at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        count: 2,
      },
      {
        chat: '!held2',
        network: 'iMessage',
        who: '+1 (555) 010-8302',
        first: 'Hey it’s Sam, new number! Still on for Saturday?',
        at: new Date(Date.now() - 26 * 3_600_000).toISOString(),
        count: 1,
      },
    ]
    const status = (): BeeperStatus => ({
      running: true,
      version: '4.3.0',
      connected: true,
      accounts: accounts.map((row) => ({ ...row })),
      held: held.map((entry) => ({ ...entry })),
      lastRun: {
        at: new Date(Date.now() - 2 * 60_000).toISOString(),
        chats: 2,
        messages: 3,
        files: 2,
        skipped: [
          { chat: 'Atlas launch team', reason: 'groups are off for Signal' },
          { chat: 'Atlas news', reason: 'read-only' },
        ],
        accountsOff: ['iMessage'],
        complete: true,
      },
    })
    const rules: string[] = []
    let checks = 0
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
        status: () => Promise.resolve(status()),
        connect: () => Promise.resolve(null),
        connection: () => null,
        token: () => Promise.resolve({ ok: false, message: 'no Beeper here' }),
        disconnect: () => Promise.resolve(),
        rule: (id, change) => {
          rules.push(`${id} ${JSON.stringify(change)}`)
          const row = accounts.find((account) => account.id === id)
          if (!row) return Promise.resolve(false)
          Object.assign(row, change, { chosen: true })
          return Promise.resolve(true)
        },
        preview: () =>
          Promise.resolve({
            rows: [
              { chat: 'Maya Okafor', network: 'Signal', group: false, pile: 'primary' as const, save: true },
              {
                chat: 'Atlas launch team',
                network: 'Signal',
                group: true,
                pile: 'primary' as const,
                save: false,
                reason: 'groups are off for Signal',
              },
              {
                chat: 'Priya Natarajan',
                network: 'iMessage',
                group: false,
                pile: 'primary' as const,
                save: accounts[1]!.save,
                ...(accounts[1]!.save ? {} : { reason: 'iMessage is off' }),
              },
              {
                chat: 'Deals',
                network: 'Signal',
                group: false,
                pile: 'low-priority' as const,
                save: false,
                reason: 'low priority',
              },
            ],
            complete: true,
          }),
        check: () => {
          checks += 1
          return Promise.resolve({ ran: true as const, chats: 2, messages: 3, files: 2, complete: true })
        },
        keep: (chat) => {
          const index = held.findIndex((entry) => entry.chat === chat)
          if (index < 0) return Promise.resolve(false)
          held.splice(index, 1)
          rules.push(`keep ${chat}`)
          return Promise.resolve(true)
        },
        open: (chat) => {
          rules.push(`open ${chat}`)
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
      voice: { current: 'marin', researcherCurrent: 'ash', groups: { male: ['ash'], female: ['marin'] } },
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
      const screenshots = env.get('SKY_BEEPER_SCREENSHOTS')
      const capture = async (name: string) => {
        if (!screenshots) return
        await page.waitForTimeout(300)
        const height = await page.evaluate(
          () => (document.querySelector('.sky-scroll') as HTMLElement).scrollHeight + 40,
        )
        await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.min(height, 4000) })
        await page.screenshot({ path: path.join(screenshots, `${name}.png`) })
      }

      await page.goto(`${base}/settings/connections`)
      const beeperRow = page.locator('.sky-set-row', { hasText: 'Beeper' }).first()
      await beeperRow.getByRole('button', { name: 'Beeper settings' }).waitFor()
      const rowBefore = await beeperRow.locator('.sky-set-sub').innerText()
      await capture('1-connections-list')
      await beeperRow.getByRole('button', { name: 'Beeper settings' }).click()
      await page.getByRole('heading', { name: 'Beeper', exact: true }).waitFor()
      await page.getByText('2 minutes ago').waitFor()
      const url = new URL(page.url()).pathname
      const networks = await page
        .locator('[aria-label^="Save "]')
        .evaluateAll((nodes) =>
          nodes.map(
            (node) =>
              `${node.getAttribute('aria-label')}=${node.querySelector('input:checked')?.getAttribute('value')}`,
          ),
        )
      const leftOut = await page.locator('.sky-set-row', { hasText: 'left out' }).locator('.sky-set-sub').innerText()
      await capture('2-beeper')

      // iMessage on: the rule goes to the service, its groups switch wakes, the list's summary follows.
      const groupsSwitch = page.locator('[aria-label="Save iMessage groups"] input').first()
      const groupsBefore = await groupsSwitch.isDisabled()
      const written = page.waitForResponse(
        (r) => r.url().includes('/beeper/accounts/im1') && r.request().method() === 'POST',
      )
      await page.locator('[aria-label="Save iMessage"]').getByText('On', { exact: true }).click()
      await written
      await page.getByText('Stays off while iMessage is off.').waitFor({ state: 'hidden' })
      const groupsAfter = await groupsSwitch.isDisabled()
      await capture('3-beeper-imessage-on')

      // The held card: Save takes a sender out of it and runs a check.
      const heldBefore = await page
        .locator('.sky-block', { hasText: 'Held for a look' })
        .locator('.sky-set-row')
        .count()
      await page
        .locator('.sky-set-row', { hasText: '010-8302' })
        .getByRole('button', { name: 'Save', exact: true })
        .click()
      await page.locator('.sky-set-row', { hasText: '010-8302' }).waitFor({ state: 'hidden' })
      const heldAfter = await page.locator('.sky-block', { hasText: 'Held for a look' }).locator('.sky-set-row').count()

      await page.getByRole('button', { name: 'Show what a check would save' }).click()
      await page.locator('.sky-block-head', { hasText: 'What a check would save' }).waitFor()
      const wouldSave = await page
        .locator('.sky-set-row', { hasText: 'would be saved' })
        .locator('.sky-set-sub')
        .innerText()
      await capture('4-beeper-preview')

      await page.getByRole('button', { name: 'Check now' }).click()
      await page.getByRole('status').filter({ hasText: 'saved' }).waitFor()
      const checkedLine = await page.getByRole('status').filter({ hasText: 'saved' }).innerText()

      await page.getByRole('button', { name: '‹ Connections' }).click()
      await beeperRow.getByRole('button', { name: 'Beeper settings' }).waitFor()
      const rowAfter = await beeperRow.locator('.sky-set-sub').innerText()

      await page.setViewportSize({ width: 390, height: 900 })
      await page.goto(`${base}/settings/connections/beeper`)
      await page.getByRole('heading', { name: 'Beeper', exact: true }).waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      await capture('5-beeper-phone')

      assert({
        given: 'the Beeper page over a scripted host, in a browser',
        should:
          'lead from the row, show each network’s switch, write a rule, read the last check back, preview, check, and fit a phone',
        actual: [
          rowBefore,
          url,
          networks,
          leftOut,
          rules,
          [groupsBefore, groupsAfter],
          [heldBefore, heldAfter],
          wouldSave,
          checks,
          checkedLine,
          rowAfter,
          overflow,
          errors,
        ],
        expected: [
          'Saving Signal. iMessage is new and waits for you.',
          '/settings/connections/beeper',
          ['Save Signal=on', 'Save Signal groups=on', 'Save iMessage=off', 'Save iMessage groups=off'],
          'groups are off for Signal (1) · read-only (1)',
          ['im1 {"save":true}', 'keep !held2'],
          [true, false],
          [2, 1],
          'Maya Okafor (Signal) · Priya Natarajan (iMessage)',
          2,
          '3 messages in 2 chats saved.',
          'Saving Signal, iMessage.',
          false,
          [],
        ],
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
