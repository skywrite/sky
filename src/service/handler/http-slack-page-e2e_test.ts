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
import { type ConnectionsHost, createConnectionsRoutes, type SlackPageView } from './settings/connections.ts'
import type { SettingsData } from './settings/mod.ts'
import type { SlackCaptureChange, SlackCaptureSettings } from './settings/slackCapture.ts'

/**
 * Slack's page under Connections, in a browser over a scripted host: the row
 * leads there, the recent checks and the piles read back, a channel's switch
 * writes the mute and the row says so, Show all and Find a channel narrow the
 * list, Check now reports what the pull did, and the page fits a phone.
 * SKY_SLACK_SCREENSHOTS names a folder for captures.
 */

test(
  {
    name: 'The Slack page: recent checks, the marks, channel switches, search, and Check now',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-slack-page-'))
    await mkdir(path.join(root, 'journal'))
    const names = [
      'atlas',
      'design',
      'widget-v2',
      'customer-wins',
      'eng-platform',
      'alerts-ci',
      'team-survey',
      'design-crit',
      'launch',
      'onboarding',
    ]
    const now = Math.floor(Date.now() / 1000)
    const forYou = { dms: true, mentions: true, own: true }
    const sets: string[] = []
    const channels: SlackPageView['channels'] = names.map((name, index) => ({
      id: `C0ATLAS000${index + 1}`,
      name,
      on: name !== 'team-survey',
      kept: index === 9 ? 0 : 200 - index * 17,
      ...(index === 9 ? {} : { lastPostEpoch: now - (index + 1) * 1800 }),
    }))
    const view = (): SlackPageView => ({
      forYou: { ...forYou },
      joined: channels.length,
      muted: channels.filter((row) => !row.on).length,
      kept: channels.reduce((sum, row) => sum + row.kept, 0),
      days: 8,
      channels: channels.map((row) => ({ ...row })),
      runs: [
        {
          at: '2026-10-19 17:48',
          added: 0,
          channels: 0,
          threads: 0,
          read: 48,
          unchanged: 350,
          muted: 1,
          errors: 0,
          seconds: 20,
        },
        {
          at: '2026-10-19 17:43',
          added: 19,
          channels: 8,
          threads: 8,
          read: 52,
          unchanged: 346,
          muted: 1,
          errors: 0,
          seconds: 21,
        },
        {
          at: '2026-10-18 09:12',
          added: 4,
          channels: 2,
          threads: 1,
          read: 40,
          unchanged: 358,
          muted: 1,
          errors: 0,
          seconds: 18,
        },
      ],
    })
    const mutes: string[] = []
    let pulls = 0
    let captureSettings: SlackCaptureSettings = { name: null, enabled: false, minutes: 5, schedule: 'every 5m' }
    const captureChanges: SlackCaptureChange[] = []
    let refuseCapture = false
    const host: ConnectionsHost = {
      secrets: new TestSecretsProvider({}),
      providers: () => [],
      google: {
        connect: () => Promise.resolve(null),
        connection: () => null,
        setup: { start: () => null, state: () => null, continue: () => false, cancel: () => false },
      },
      slack: {
        status: () =>
          Promise.resolve({
            installed: true,
            ok: true,
            workspace: 'https://atlas.slack.com',
            team: 'Atlas Labs',
            user: 'jane',
            displayName: 'Jane Doe',
          }),
        reconnect: () => Promise.resolve({ installed: false }),
        channels: () => Promise.resolve(view()),
        mute: (id, muted) => {
          mutes.push(`${id} ${muted ? 'muted' : 'on'}`)
          const row = channels.find((channel) => channel.id === id)
          if (!row) return Promise.resolve(false)
          row.on = !muted
          return Promise.resolve(true)
        },
        pull: () => {
          pulls += 1
          return Promise.resolve({
            ran: true as const,
            added: 3,
            channels: 2,
            threads: 1,
            read: 5,
            muted: 1,
            errors: 0,
          })
        },
        marks: () => Promise.resolve({ todos: 3, overdue: 1, saved: 12 }),
        captureAutomation: {
          read: async () => captureSettings,
          update: async (change) => {
            if (refuseCapture) throw new Error('Slack capture could not be saved. Your current schedule is unchanged.')
            captureChanges.push(change)
            captureSettings = {
              name: 'slack-capture',
              enabled: change.enabled ?? captureSettings.enabled,
              minutes: change.minutes ?? captureSettings.minutes,
              schedule: `every ${change.minutes ?? captureSettings.minutes}m`,
            }
            return captureSettings
          },
        },
      },
      beeper: {
        status: () => Promise.resolve({ running: false, connected: false, accounts: [], held: [] }),
        connect: () => Promise.resolve(null),
        connection: () => null,
        token: () => Promise.resolve({ ok: false, message: 'no Beeper here' }),
        disconnect: () => Promise.resolve(),
        rule: () => Promise.resolve(false),
        preview: () => Promise.resolve(null),
        check: () => Promise.resolve({ ran: false, reason: 'no Beeper here' }),
        keep: () => Promise.resolve(false),
        open: () => Promise.resolve(null),
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
    app.post('/settings/_api/set', async (c) => {
      const body = (await c.req.json()) as { key: string; value: string }
      sets.push(`${body.key}=${body.value}`)
      const rule = body.key.replace(/^slack\.forYou\./, '')
      if (rule === 'dms' || rule === 'mentions' || rule === 'own') forYou[rule] = body.value === 'true'
      return c.json({ ok: true })
    })
    app.route('/settings/_api/connections', createConnectionsRoutes(host))
    app.get('/automations/_api/status', (c) =>
      c.json({
        rows: [
          {
            name: 'slack-capture',
            kind: 'system',
            run: 'slack:saved, slack:todos',
            commands: [
              { run: 'slack:saved', args: { captureAll: true } },
              { run: 'slack:todos', args: { captureAll: true } },
            ],
            trigger: captureSettings.schedule,
            frame: 'elapsed',
            state: captureSettings.enabled ? 'active' : 'paused',
            due: false,
            brief: 'Capture my saved Slack messages and to-dos.',
            unknownKeys: [],
            file: 'slack-capture.md',
            runs: [],
          },
        ],
        charterErrors: [],
        dir: '/Notebook/automations',
      }),
    )
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
      const screenshots = env.get('SKY_SLACK_SCREENSHOTS')
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
      const slackRow = page.locator('.sky-set-row', { has: page.getByRole('button', { name: 'Slack settings' }) })
      await slackRow.waitFor()
      const rowBefore = await slackRow.locator('.sky-set-sub').innerText()
      await capture('1-connections-list')
      await slackRow.getByRole('button', { name: 'Slack settings' }).click()
      await page.getByRole('heading', { name: 'Slack', exact: true }).waitFor()
      await page.getByText('19 messages in 8 channels').waitFor()
      await page.getByText('3 open · 1 overdue').waitFor()
      const url = new URL(page.url()).pathname
      const title = await page.title()
      const workspaceLine = await page
        .locator('.sky-block', { hasText: 'Status' })
        .locator('.sky-set-row')
        .first()
        .locator('.sky-set-sub')
        .innerText()
      const runs = await page
        .locator('.sky-set-run')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node.querySelector('.sky-set-run-txt') as HTMLElement).firstChild?.textContent),
        )
      const switchesBefore = await page.locator('[aria-label^="Keep #"]').count()
      const countBefore = await page.locator('.sky-set-count').innerText()
      await capture('2-slack')

      const captureSwitch = page.locator('[aria-label="Automatically capture saved Slack messages and to-dos"]')
      await captureSwitch.waitFor()
      const captureWritten = () =>
        page.waitForResponse((r) => r.url().endsWith('/slack/capture-automation') && r.request().method() === 'POST')
      const enable = captureWritten()
      await captureSwitch.getByText('On', { exact: true }).click()
      await enable
      await page.getByText('Runs while the Sky service is running.').waitFor()
      await page.getByRole('combobox', { name: 'Slack capture interval' }).click()
      const interval = captureWritten()
      await page.getByRole('option', { name: 'Every 15 minutes', exact: true }).click()
      await interval
      refuseCapture = true
      const refused = captureWritten()
      await captureSwitch.getByText('Off', { exact: true }).click()
      await refused
      await page.getByRole('alert').filter({ hasText: 'Your current schedule is unchanged.' }).waitFor()
      const keptEnabled = await captureSwitch.locator('input[value="on"]').isChecked()
      refuseCapture = false
      const pause = captureWritten()
      await captureSwitch.getByText('Off', { exact: true }).click()
      await pause
      await page.getByText('Automatic capture is off.').waitFor()
      await page.getByRole('button', { name: 'View automation' }).click()
      await page.waitForURL('**/automations/slack-capture')
      await page.goBack()
      await page.getByRole('heading', { name: 'Slack', exact: true }).waitFor()
      await page.goForward()
      await page.waitForURL('**/automations/slack-capture')
      await page.goBack()
      await page.getByRole('heading', { name: 'Slack', exact: true }).waitFor()
      await page.getByRole('combobox', { name: 'Slack capture interval' }).waitFor()
      const refreshedCapture = page.waitForResponse(
        (r) => r.url().endsWith('/slack/capture-automation') && r.request().method() === 'GET',
      )
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await refreshedCapture
      assert({
        given: 'Slack capture enabled, changed to fifteen minutes, paused, and revisited through browser history',
        should:
          'write the one automation, keep its setting on a failed save, and restore the Slack title and saved interval',
        actual: [
          captureChanges,
          keptEnabled,
          await page.title(),
          await page.getByRole('combobox', { name: 'Slack capture interval' }).inputValue(),
        ],
        expected: [[{ enabled: true }, { minutes: 15 }, { enabled: false }], true, 'sky · Slack', 'Every 15 minutes'],
      })
      await capture('2b-slack-capture')

      // For you: a rule's switch writes the key, and the row says what is off.
      const ruleWritten = page.waitForResponse((r) => r.url().endsWith('/settings/_api/set'))
      await page.locator('[aria-label="Land direct messages"]').getByText('Off', { exact: true }).click()
      await ruleWritten
      await page.getByText('Off. Direct messages stay in Slack.').waitFor()

      // Mute a channel: the rule goes to the service, the row says so, the count follows.
      const designRow = page.locator('.sky-set-row', { has: page.locator('[aria-label="Keep #design"]') })
      const written = page.waitForResponse(
        (r) => r.url().includes('/slack/channels/C0ATLAS0002') && r.request().method() === 'POST',
      )
      await page.locator('[aria-label="Keep #design"]').getByText('Off', { exact: true }).click()
      await written
      await designRow.locator('.sky-set-chip', { hasText: 'Muted' }).waitFor()
      await page.locator('.sky-set-count', { hasText: '2 muted' }).waitFor()
      const designSub = await designRow.locator('.sky-set-sub').innerText()
      await capture('3-slack-muted')

      // Show all, then find one.
      await page.getByRole('button', { name: /^Show all/ }).click()
      const switchesAll = await page.locator('[aria-label^="Keep #"]').count()
      await page.getByLabel('Find a channel').fill('wid')
      const found = await page
        .locator('[aria-label^="Keep #"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
      await page.getByLabel('Find a channel').fill('')

      await page.getByRole('button', { name: 'Check now' }).click()
      await page.getByRole('status').filter({ hasText: 'kept' }).waitFor()
      const checkedLine = await page.getByRole('status').filter({ hasText: 'kept' }).innerText()

      await page.getByRole('button', { name: '‹ Connections' }).click()
      await slackRow.getByRole('button', { name: 'Slack settings' }).waitFor()

      await page.setViewportSize({ width: 390, height: 900 })
      await page.goto(`${base}/settings/connections/slack`)
      await page.getByRole('heading', { name: 'Slack', exact: true }).waitFor()
      await page.getByText('19 messages in 8 channels').waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      await capture('4-slack-phone')

      assert({
        given: 'the Slack page over a scripted host, in a browser',
        should:
          'lead from the row, name the workspace, list the checks, switch a channel off, narrow the list, run a check, and fit a phone',
        actual: [
          rowBefore,
          url,
          title,
          workspaceLine,
          runs,
          [switchesBefore, countBefore],
          sets,
          mutes,
          designSub,
          switchesAll,
          found,
          [pulls, checkedLine],
          overflow,
          errors,
        ],
        expected: [
          'Atlas Labs · atlas.slack.com',
          '/settings/connections/slack',
          'sky · Slack',
          'atlas.slack.com · signed in as Jane Doe',
          ['Nothing new', '19 messages in 8 channels', '4 messages in 2 channels'],
          [8, '10 joined · 1 muted'],
          ['slack.forYou.dms=false'],
          ['C0ATLAS0002 muted'],
          'Muted. 183 messages kept before; nothing more is.',
          10,
          ['Keep #widget-v2'],
          [1, '3 messages in 2 channels kept.'],
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
