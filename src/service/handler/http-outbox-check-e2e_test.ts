import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { dayRange } from '#lib/outbox/range.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import type { ScanProgress } from '#lib/outbox/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestScanExecution } from '../../test/scanExecution.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { createScanJob } from './outbox/scanJob.ts'

test(
  {
    name: 'Outbox Check now keeps progress through reload and a temporary connection outage',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-browser-'))
    const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
    const selectedRange = { start: '2025-03-14T08:30', end: '2025-03-15T17:45' }
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    let progress: ScanProgress | null = null
    const execution = createTestScanExecution(
      async () => {
        calls++
        progress = {
          id: 'example-check',
          date: '2025-03-15',
          range: (await store.scanRange('2025-03-15')).value,
          at: '2025-03-15 12:00',
          owner: 1,
          status: 'running',
          outcome: 'nothing',
          considered: 12,
          total: 12,
          completed: 6,
          prepared: 0,
          ignored: 6,
          stale: 0,
          failed: 0,
          pending: 6,
          checks: [
            {
              key: 'sample',
              version: 'v1',
              refs: [],
              medium: 'Slack',
              title: 'Atlas update received',
              disposition: 'ignored',
              reason: 'Jane acknowledged the completed update; no question remains.',
              model: 'test-model',
            },
          ],
        }
        await hold
        progress = { ...progress, status: 'complete', outcome: 'acted', completed: 12, ignored: 12, pending: 0 }
        return { outcome: 'acted', message: 'Checked 12 of 12 saved conversations. The selected range is checked.' }
      },
      async () => progress,
    )
    let job = createScanJob(execution, async () => progress)
    const app = createTestHttpApp([path.join(root, 'time')], {
      chat: {
        createSession: async () => {
          throw new Error('No chat fixture')
        },
        timeDir: path.join(root, 'time'),
      },
      outbox: {
        report: async () => ({
          items: [],
          preferences: { text: '', revision: 'v1' },
          automation: { name: 'outbox', status: 'paused' },
          lastScan: null,
          check: await job.status(),
          search: await store.scanRange('2025-03-15'),
          today: '2025-03-15',
          modelLabel: 'Fable 5.1 · High',
        }),
        scan: async (selection) => {
          if (selection) await store.saveScanRange(selection.range, selection.revision, '2025-03-15')
          return job.start()
        },
        setup: async () => ({}),
        save: async () => {
          throw new Error('No review fixture')
        },
        approve: async () => {
          throw new Error('No native writes in this test')
        },
        dismiss: async () => {
          throw new Error('No review fixture')
        },
        preferences: async () => {},
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/outbox`)
      await page.getByLabel('From', { exact: true }).fill(selectedRange.start)
      await page.getByLabel('Through', { exact: true }).fill('2025-03-13T17:45')
      const invalidDisabled = await page.getByRole('button', { name: 'Check now', exact: true }).isDisabled()
      await page.getByLabel('Through', { exact: true }).fill(selectedRange.end)
      const response = page.waitForResponse((value) => value.url().endsWith('/outbox/_api/scan'))
      await page.getByRole('button', { name: 'Check now', exact: true }).click()
      const accepted = await response
      const requested = accepted.request().postDataJSON()
      await page.getByRole('status').filter({ hasText: '6 of 12 checked' }).waitFor()
      job = createScanJob(execution, async () => progress)
      await page.reload()
      await page.getByRole('status').filter({ hasText: '6 of 12 checked' }).waitFor()
      const disabled = await page.getByRole('button', { name: 'Checking…', exact: true }).isDisabled()
      const reloadedRange = [
        await page.getByLabel('From', { exact: true }).inputValue(),
        await page.getByLabel('Through', { exact: true }).inputValue(),
      ]
      await page.route('**/outbox/_api/status', (route) => route.abort('connectionrefused'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      const reconnecting = page.getByRole('status').filter({ hasText: 'Reconnecting to Sky' })
      await reconnecting.waitFor()
      const retainedProgress = await page.getByRole('status').filter({ hasText: '6 of 12 checked' }).isVisible()
      const checkingDuringOutage = await page.getByRole('button', { name: 'Checking…', exact: true }).isDisabled()
      await page.unroute('**/outbox/_api/status')
      await reconnecting.waitFor({ state: 'hidden' })
      release()
      await page.getByRole('status').filter({ hasText: 'The selected range is checked.' }).waitFor()
      await page.getByText('What Sky checked', { exact: false }).click()
      await page.getByText('Jane acknowledged the completed update; no question remains.', { exact: true }).waitFor()
      await page.reload()
      await page.getByRole('status').filter({ hasText: 'The selected range is checked.' }).waitFor()
      await page.getByText('Fable 5.1 · High', { exact: true }).waitFor()
      if (env.get('SKY_BROWSER_SCREENSHOT'))
        await page.screenshot({ path: env.get('SKY_BROWSER_SCREENSHOT')!, fullPage: true })
      await page
        .getByRole('region', { name: 'Search range' })
        .getByRole('button', { name: 'Today', exact: true })
        .click()
      const todayStart = await page.getByLabel('From', { exact: true }).inputValue()
      assert({
        given: 'Check now with a new server host, a page reload, and a temporary status connection outage',
        should: 'retain progress, reconnect automatically, finish, and expose the skip reason',
        actual: [
          accepted.status(),
          invalidDisabled,
          disabled,
          retainedProgress,
          checkingDuringOutage,
          requested.range,
          reloadedRange,
          (await job.status()).progress?.range,
          todayStart,
          calls,
          errors,
        ],
        expected: [
          202,
          true,
          true,
          true,
          true,
          selectedRange,
          [selectedRange.start, selectedRange.end],
          selectedRange,
          dayRange('2025-03-15').start,
          1,
          [],
        ],
      })
      let droppedStatus: number | undefined
      await page.route('**/outbox/_api/scan', async (route) => {
        const response = await route.fetch()
        droppedStatus = response.status()
        await route.abort('connectionreset')
      })
      const lostAcknowledgment = page.waitForEvent('requestfailed', {
        predicate: (request) => request.url().endsWith('/outbox/_api/scan'),
      })
      await page.getByRole('button', { name: 'Check now', exact: true }).click()
      await lostAcknowledgment
      await page.getByRole('button', { name: 'Check now', exact: true }).waitFor()
      await page.getByRole('status').filter({ hasText: 'The selected range is checked.' }).waitFor()
      const savedRange = await store.scanRange('2025-03-15')
      const recoveredRange = [
        await page.getByLabel('From', { exact: true }).inputValue(),
        await page.getByLabel('Through', { exact: true }).inputValue(),
      ]
      await page.unroute('**/outbox/_api/scan')
      const retryResponse = page.waitForResponse((response) => response.url().endsWith('/outbox/_api/scan'))
      await page.getByRole('button', { name: 'Check now', exact: true }).click()
      const retry = await retryResponse
      await page.getByRole('status').filter({ hasText: 'The selected range is checked.' }).waitFor()
      assert({
        given: 'the server saves a changed range but its acceptance response is lost',
        should: 'recover the saved range revision and allow another check without reloading',
        actual: [droppedStatus, recoveredRange, retry.status(), retry.request().postDataJSON().revision, calls, errors],
        expected: [202, [savedRange.value.start, savedRange.value.end], 202, savedRange.revision, 3, []],
      })
    } finally {
      release()
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
