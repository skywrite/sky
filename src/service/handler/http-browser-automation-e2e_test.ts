import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { CredentialError } from '#lib/credentials/errors.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import {
  browserAutomationTestHost,
  SAMPLE_ACCOUNT,
  SAMPLE_ID,
  SAMPLE_PASSWORD,
} from './settings/browserAutomation/testHost.ts'
import { createSettingsRoutes, type SettingsRoutesOptions } from './settings/mod.ts'

test(
  {
    name: 'Browser automation configures password managers without an inventory or credential access',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 90000,
  },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sky-browser-settings-e2e-'))
    await mkdir(path.join(dir, 'journal'))
    const fixture = browserAutomationTestHost(dir)
    const app = new Hono()
    let theme = 'light'
    let releaseApproval = () => {}
    let storedKey = ''
    const mockKey = 'mock-typesafe-key-for-settings'
    const connectRequests: unknown[] = []
    const apiBodies: string[] = []
    app.use('/settings/_api/browser-automation/connect', async (c, next) => {
      connectRequests.push(await c.req.json())
      await next()
    })
    app.get('/settings/_api/settings', (c) =>
      c.json({
        theme,
        textSize: 'default',
        experimental: { workstreams: false },
        transcription: { value: 'openai/gpt-transcribe', choices: [] },
        calendar: { classifyEvents: false },
        voice: { current: 'marin', researcherCurrent: 'ash', groups: { female: ['marin'], male: ['ash'] } },
        models: [],
        profiles: [],
        providers: [],
        writingVoice: { profile: 'sample', choices: [] },
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
      }),
    )
    app.get('/settings/_api/connections', (c) =>
      c.json({ google: { client: false, accounts: [], setup: [] }, secrets: [] }),
    )
    app.get('/settings/_api/connections/slack', (c) => c.json({ installed: false }))
    app.get('/settings/_api/connections/beeper', (c) => c.json({ running: false, connected: false, accounts: [] }))
    app.get('/settings/_api/connections/typesafe', (c) =>
      c.json({ connected: !!storedKey, models: storedKey ? ['Example model'] : [] }),
    )
    app.post('/settings/_api/connections/typesafe/key', async (c) => {
      storedKey = (await c.req.json()).key
      return c.json({ ok: true })
    })
    app.route('/settings/_api', createSettingsRoutes({ browserAutomation: fixture.host } as SettingsRoutesOptions))
    app.route('/', createTestHttpApp([path.join(dir, 'journal')]))
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.url().includes('/settings/_api/'))
          void response
            .text()
            .then((body) => apiBodies.push(body))
            .catch(() => {})
      })
      const base = `http://127.0.0.1:${address.port}`
      const screenshots = env.get('SKY_BROWSER_AUTOMATION_SCREENSHOTS')
      const capture = async (name: string) => {
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true, animations: 'disabled' })
      }
      const closeDialog = async () => {
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
      }
      await page.goto(`${base}/settings/credentials`)
      await page.getByRole('heading', { name: 'Browser automation', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Connect', exact: true }).waitFor()
      assert({
        given: 'first use through the old Credentials link',
        should: 'show Browser automation with honest manual sign-in and no item inventory or setup instructions',
        actual: [
          await page.locator('.sky-settings-nav [aria-current="page"]').innerText(),
          await page.getByRole('textbox', { name: 'Search credentials' }).count(),
          await page.getByRole('button', { name: 'Add credential' }).count(),
          await page.getByRole('region', { name: '1Password setup' }).count(),
          fixture.counts.discovered,
          fixture.counts.vaultLists,
          await page.getByText('Not available yet', { exact: true }).count(),
          await page.getByText('Manual', { exact: true }).count(),
        ],
        expected: ['Browser automation', 0, 0, 0, 0, 0, 1, 1],
      })
      await capture('browser-automation-first-use')
      const discover = fixture.options.discover
      fixture.options.discover = async () => {
        throw new CredentialError('integration-required')
      }
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByRole('dialog').getByRole('alert').waitFor()
      await page.getByRole('dialog').getByRole('button', { name: 'Open 1Password settings' }).click()
      assert({
        given: 'a connection issue',
        should: 'show setup help only after Connect without asking for account details',
        actual: [await page.getByRole('dialog').getByRole('textbox').count(), fixture.counts.opened],
        expected: [0, 1],
      })
      await capture('browser-automation-connection-help')
      fixture.options.discover = async () => [...(await discover()), { id: 'example-work', label: 'Example work' }]
      const inspect = fixture.options.inspectAccount
      const approval = new Promise<void>((resolve) => {
        releaseApproval = resolve
      })
      fixture.options.inspectAccount = async (source) => {
        await approval
        return inspect(source)
      }
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
      await page.getByRole('status').getByText('Connecting to 1Password…').waitFor()
      assert({
        given: 'native approval is pending',
        should: 'wait without an account form, second Continue button, or prerequisite checklist',
        actual: [
          await page.getByRole('dialog').getByRole('textbox').count(),
          await page.getByRole('button', { name: 'Continue with 1Password' }).count(),
          await page.getByRole('region', { name: '1Password setup' }).count(),
          connectRequests,
        ],
        expected: [0, 0, 0, [{}, {}]],
      })
      releaseApproval()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.getByText('2 accounts set up for browser sign-in', { exact: true }).waitFor()
      assert({
        given: 'two accounts connected',
        should: 'keep a single 1Password row and never list or read items',
        actual: [
          await page.locator('.sky-browser-manager-title').getByText('1Password', { exact: true }).count(),
          await page.getByText('Approval required', { exact: true }).count(),
          fixture.counts.itemLists,
          fixture.counts.read,
          fixture.counts.write,
        ],
        expected: [1, 1, 0, 0, 0],
      })
      await capture('browser-automation')
      theme = 'dark'
      await page.reload()
      await page.locator('html[data-mantine-color-scheme="dark"]').waitFor()
      await page.getByRole('button', { name: 'Manage', exact: true }).waitFor()
      await capture('browser-automation-dark')
      theme = 'light'
      await page.reload()
      await page.getByRole('button', { name: 'Manage', exact: true }).click()
      const account = page
        .locator('.sky-browser-account')
        .filter({ has: page.getByText(SAMPLE_ACCOUNT, { exact: true }) })
      await account.getByRole('switch', { name: `Include all vaults from ${SAMPLE_ACCOUNT}` }).focus()
      await page.keyboard.press('Space')
      await account.getByRole('checkbox', { name: 'Work', exact: true }).focus()
      await page.keyboard.press('Space')
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      const inspections = fixture.counts.inspected
      fixture.state.inspectionFailure = true
      await page.reload()
      await page.getByRole('button', { name: 'Manage', exact: true }).waitFor()
      assert({
        given: 'a later locked provider',
        should: 'load saved settings without reconnecting or losing scope',
        actual: [
          fixture.counts.inspected,
          (await fixture.host.snapshot()).passwordManagers[0].excludedVaultIds,
          await page.getByRole('alert').count(),
        ],
        expected: [inspections, ['work'], 0],
      })
      fixture.state.inspectionFailure = false
      fixture.vaults.push({ id: 'shared', title: 'Shared' })
      await page.getByRole('button', { name: 'Manage', exact: true }).click()
      await account.getByRole('button', { name: 'Refresh vaults', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Manage', exact: true }).click()
      await account.getByRole('checkbox', { name: 'Shared', exact: true }).waitFor()
      await capture('browser-automation-accounts')
      assert({
        given: 'explicitly refreshing vaults',
        should: 'keep the exclusion and discover new vaults without item access',
        actual: [
          (await fixture.host.snapshot()).passwordManagers[0].excludedVaultIds,
          fixture.counts.inspected,
          fixture.counts.itemLists,
        ],
        expected: [['work'], inspections + 1, 0],
      })
      await closeDialog()
      await page.setViewportSize({ width: 390, height: 844 })
      await capture('browser-automation-mobile')
      assert({
        given: 'the phone layout',
        should: 'fit the viewport',
        actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        expected: false,
      })
      await page.setViewportSize({ width: 1440, height: 1120 })
      await page.goto(`${base}/settings/credentials/typesafe`)
      await page.getByRole('heading', { name: 'TypeSafe', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByLabel('API key', { exact: true }).fill(mockKey)
      await page.getByRole('button', { name: 'Save to keychain', exact: true }).click()
      await page.getByRole('button', { name: 'Change', exact: true }).waitFor()
      assert({
        given: 'the existing TypeSafe link and an entered API key',
        should: 'use its integration setup, clear the input, and avoid returning the key',
        actual: [
          await page.locator('.sky-settings-nav [aria-current="page"]').innerText(),
          storedKey,
          await page.getByLabel('API key', { exact: true }).count(),
          apiBodies.some((body) => body.includes(mockKey) || body.includes(SAMPLE_PASSWORD)),
        ],
        expected: ['Connections', mockKey, 0, false],
      })
      await page.getByRole('button', { name: '‹ Connections', exact: true }).click()
      await page.getByRole('button', { name: 'Manage key', exact: true }).click()
      await page.getByRole('heading', { name: 'TypeSafe', exact: true }).waitFor()
      assert({
        given: 'Connections → TypeSafe',
        should: 'use the new integration URL',
        actual: new URL(page.url()).pathname,
        expected: '/settings/connections/typesafe',
      })
      await page.goto(`${base}/settings/browser-automation`)
      await page.getByRole('button', { name: 'Manage', exact: true }).click()
      await account.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await account.getByRole('button', { name: 'Disconnect account', exact: true }).click()
      await account.waitFor({ state: 'hidden' })
      await closeDialog()
      const retired = await page.request.post(`${base}/settings/_api/credentials/read`, {
        data: { ref: { connectionId: SAMPLE_ID, containerId: 'work', itemId: 'atlas' }, fields: [{ id: 'password' }] },
      })
      assert({
        given: 'disconnecting an account and requesting the old reveal endpoint',
        should: 'retain only the other setup and deny secret access without browser errors',
        actual: [
          (await fixture.host.snapshot()).passwordManagers.length,
          retired.status(),
          fixture.counts.itemLists,
          fixture.counts.read,
          fixture.counts.write,
          errors,
        ],
        expected: [1, 410, 0, 0, 0, []],
      })
    } finally {
      releaseApproval()
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(dir, { recursive: true, force: true })
    }
  },
)
