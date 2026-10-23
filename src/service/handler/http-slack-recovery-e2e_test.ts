import { slackIssueMessage } from '#commands/all/slack/lib/connection.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { SlackStatus } from './settings/connections.ts'

test(
  { name: 'Slack retries wake-time network failures silently and clears stale connection UI', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Sample\n', tempPrefix: 'sky-slack-network-browser-' },
      async ({ page, origin, errors }) => {
        await page.clock.install()
        const workspace = 'https://atlas.slack.com'
        let status: SlackStatus = {
          installed: true,
          ok: false,
          reason: 'network',
          workspace,
          error: slackIssueMessage({ reason: 'network', workspace }),
        }
        let reads = 0
        let authentications = 0
        let finish!: () => void
        let began!: () => void
        const started = new Promise<void>((resolve) => {
          began = resolve
        })
        await page.route('**/settings/_api/settings', (route) =>
          route.fulfill({ json: { theme: 'light', textSize: 'default' } }),
        )
        await page.route('**/settings/_api/connections?accountsOnly=true', (route) =>
          route.fulfill({
            json: { google: { client: false, accounts: [], setup: [], leftovers: [] }, secrets: [] },
          }),
        )
        await page.route('**/settings/_api/connections/beeper', (route) =>
          route.fulfill({ json: { running: false, connected: false, accounts: [] } }),
        )
        await page.route('**/settings/_api/connections/slack/reconnect', (route) => {
          authentications++
          return route.fulfill({ json: status })
        })
        await page.route(/\/settings\/_api\/connections\/slack(?:\?|$)/, async (route) => {
          reads++
          if (reads === 1) {
            await route.fulfill({ status: 503, json: { message: 'Temporarily unavailable.' } })
            return
          }
          if (reads === 2) {
            began()
            await new Promise<void>((resolve) => {
              finish = resolve
            })
          }
          await route.fulfill({ json: status })
        })
        await page.route('**/service/status', (route) =>
          route.fulfill({
            json: {
              data: {
                pending: null,
                holding: [],
                ...(status.installed && !status.ok
                  ? { slack: { count: 1, message: status.error, workspace, reason: status.reason } }
                  : {}),
              },
            },
          }),
        )
        await page.goto(`${origin}/settings/connections?slackWorkspace=${encodeURIComponent(workspace)}`)
        const slack = page.locator('.sky-set-row').filter({ has: page.getByText('Slack', { exact: true }) })
        await slack.getByText('Reconnecting…', { exact: true }).waitFor()
        await page.getByText('Slack reconnecting…', { exact: true }).waitFor()
        assert({
          given: 'a wake-time network interruption',
          should: 'offer a silent check and show reconnection without an authentication warning',
          actual: [
            await slack.getByRole('button', { name: 'Check now', exact: true }).count(),
            await slack.getByRole('button', { name: 'Restore access', exact: true }).count(),
            await slack.getByRole('alert').count(),
            (await page.locator('.sky-restart').innerText()).toLowerCase().includes('restore access'),
          ],
          expected: [1, 0, 0, false],
        })

        await page.clock.fastForward(5000)
        await started
        await page.clock.fastForward(30000)
        await page.evaluate(() => {
          window.dispatchEvent(new Event('online'))
        })
        assert({
          given: 'the first automatic check remains in flight through more timers and a network-online event',
          should: 'keep one request in flight and never start authentication',
          actual: [reads, authentications],
          expected: [2, 0],
        })
        finish()
        await slack.getByRole('button', { name: 'Check now', exact: true }).waitFor()
        await page.waitForFunction(() => {
          const row = [...document.querySelectorAll('.sky-set-row')].find((item) =>
            item.textContent?.includes('Reconnecting…'),
          )
          return row && !(row.querySelector('button') as HTMLButtonElement)?.disabled
        })
        await page.clock.fastForward(2500)
        // An early check would reach the route a moment after the jump; let it arrive before counting.
        await page.waitForTimeout(500)
        assert({
          given: 'an unsuccessful automatic check, halfway through the wait',
          should: 'not check again yet',
          actual: reads,
          expected: 2,
        })
        status = { installed: true, ok: true, workspace, team: 'Atlas', user: 'jane', displayName: 'Jane Doe' }
        await page.clock.fastForward(3500)
        await slack.getByText('Connected', { exact: true }).waitFor()
        await page.clock.fastForward(5000)
        await page.getByText('Slack reconnecting…', { exact: true }).waitFor({ state: 'hidden' })
        assert({
          given: 'the network is available on the next silent check',
          should: 'clear the row and sidebar warning without importing tokens or changing the title',
          actual: [
            reads,
            authentications,
            await slack.getByText('Reconnecting…', { exact: true }).count(),
            await page.title(),
          ],
          expected: [3, 0, 0, 'sky · Connections'],
        })

        status = {
          installed: true,
          ok: false,
          reason: 'network',
          workspace,
          error: 'Slack is temporarily unreachable.',
        }
        await slack.getByRole('button', { name: 'Check', exact: true }).click()
        await slack.getByText('Reconnecting…', { exact: true }).waitFor()
        status = {
          installed: true,
          ok: false,
          reason: 'keychain',
          workspace,
          error: 'macOS is blocking access to saved credentials.',
        }
        await page.clock.fastForward(5000)
        await slack.getByRole('button', { name: 'Restore access', exact: true }).waitFor()
        const stoppedAt = reads
        await page.clock.fastForward(60000)
        assert({
          given: 'a silent retry encounters an actual Keychain access failure',
          should: 'stop automatic retries and wait for explicit recovery',
          actual: [reads, authentications, await slack.getByText('Reconnecting…', { exact: true }).count()],
          expected: [stoppedAt, 0, 0],
        })
        await page.setViewportSize({ width: 390, height: 844 })
        assert({
          given: 'reconnection and access failure on the Connections screen',
          should: 'keep recovery usable on mobile and raise no browser errors',
          actual: [
            await slack.getByRole('button', { name: 'Restore access', exact: true }).isVisible(),
            errors.filter((error) => !error.includes('503 (Service Unavailable)')),
          ],
          expected: [true, []],
        })
      },
    )
  },
)

test(
  { name: 'Slack stays paused during polling and recovers only on an explicit action', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Sample\n', tempPrefix: 'sky-slack-browser-' },
      async ({ page, origin, errors }) => {
        await page.clock.install()
        let status: SlackStatus = {
          installed: true,
          ok: false,
          reason: 'keychain',
          workspace: 'https://atlas.slack.com',
          error: 'macOS is blocking access to the saved Slack credentials. Syncing is paused.',
        }
        let restores = 0
        let pauses = 0
        let polls = 0
        let selectedWorkspace: string | undefined
        let restoredWorkspace: string | undefined
        let finish!: () => void
        await page.route('**/settings/_api/settings', (route) =>
          route.fulfill({ json: { theme: 'light', textSize: 'default' } }),
        )
        await page.route('**/settings/_api/connections?accountsOnly=true', (route) =>
          route.fulfill({
            json: { google: { client: false, accounts: [], setup: [], leftovers: [] }, secrets: [] },
          }),
        )
        await page.route('**/settings/_api/connections/beeper', (route) =>
          route.fulfill({ json: { running: false, connected: false, accounts: [] } }),
        )
        await page.route(/\/settings\/_api\/connections\/slack(?:\?|$)/, (route) => {
          selectedWorkspace = new URL(route.request().url()).searchParams.get('workspace') ?? undefined
          return route.fulfill({ json: status })
        })
        await page.route('**/settings/_api/connections/slack/reconnect', async (route) => {
          restores++
          restoredWorkspace = route.request().postDataJSON().workspace
          await new Promise<void>((resolve) => {
            finish = resolve
          })
          if (restores > 1)
            status = {
              installed: true,
              ok: true,
              workspace: 'https://atlas.slack.com',
              team: 'Atlas',
              user: 'jane',
              displayName: 'Jane Doe',
            }
          await route.fulfill({ json: status })
        })
        await page.route('**/settings/_api/connections/slack/pause', async (route) => {
          pauses++
          status = {
            installed: true,
            ok: false,
            reason: 'paused',
            workspace: 'https://atlas.slack.com',
            error: 'Slack syncing is paused.',
          }
          await route.fulfill({ json: status })
        })
        await page.route('**/service/status', (route) => {
          polls++
          return route.fulfill({
            json: {
              data: {
                pending: null,
                holding: [],
                ...(status.installed && !status.ok
                  ? { slack: { count: 1, message: status.error, workspace: 'https://widget.slack.com' } }
                  : {}),
              },
            },
          })
        })
        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.goto(`${origin}/settings/connections`)
        const slack = page.locator('.sky-set-row').filter({ has: page.getByText('Slack', { exact: true }) })
        const restore = slack.getByRole('button', { name: 'Restore access', exact: true })
        await restore.waitFor()
        await page.getByRole('link', { name: 'Manage Slack access' }).waitFor()
        await page.clock.fastForward(20000)
        assert({
          given: 'a directly opened Connections page and repeated shell polling',
          should: 'show one actionable pause notice, preserve the title, and never restore automatically',
          actual: [
            await page.title(),
            restores,
            polls > 1,
            await page.getByRole('link', { name: 'Manage Slack access' }).count(),
          ],
          expected: ['sky · Connections', 0, true, 1],
        })

        const requested = page.waitForRequest('**/settings/_api/connections/slack/reconnect')
        await restore.click()
        await requested
        await slack.getByRole('button', { name: 'Restoring…', exact: true }).waitFor()
        assert({
          given: 'explicit Slack recovery is still pending',
          should: 'disable additional attempts',
          actual: [await slack.getByRole('button').isDisabled(), restores],
          expected: [true, 1],
        })
        finish()
        await restore.waitFor()
        await page.reload()
        await restore.waitFor()
        assert({
          given: 'recovery was cancelled and the page reloaded',
          should: 'keep the pause and wait for another deliberate action',
          actual: [restores, await slack.getByText('Paused', { exact: true }).count()],
          expected: [1, 1],
        })

        const retried = page.waitForRequest('**/settings/_api/connections/slack/reconnect')
        await restore.click()
        await retried
        finish()
        await slack.getByText('Connected', { exact: true }).waitFor()
        await slack.getByRole('button', { name: 'Pause syncing', exact: true }).click()
        await restore.waitFor()
        assert({
          given: 'the saved session works, then the owner pauses syncing',
          should: 'show the verified name and preserve the explicit pause',
          actual: [restores, pauses, await slack.getByText('Paused', { exact: true }).count()],
          expected: [2, 1, 1],
        })

        await page.locator('.sky-settings-nav').getByRole('button', { name: 'Browser automation', exact: true }).click()
        await page.waitForFunction(() => document.title === 'sky · Browser automation')
        await page.goBack()
        await restore.waitFor()
        await page.clock.fastForward(5000)
        assert({
          given: 'back navigation followed by a background refresh',
          should: 'retain the Connections title and raise no browser errors',
          actual: [await page.title(), errors],
          expected: ['sky · Connections', []],
        })
        await page.goForward()
        await page.waitForFunction(() => document.title === 'sky · Browser automation')
        await page.goBack()
        await restore.waitFor()
        await page.setViewportSize({ width: 390, height: 844 })
        assert({
          given: 'the same pause on mobile',
          should: 'keep recovery available without automatic attempts',
          actual: [await restore.isVisible(), restores],
          expected: [true, 2],
        })
        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.getByRole('link', { name: 'Manage Slack access' }).click()
        await restore.waitFor()
        const selectedRequest = page.waitForRequest('**/settings/_api/connections/slack/reconnect')
        await restore.click()
        await selectedRequest
        finish()
        await slack.getByText('Connected', { exact: true }).waitFor()
        assert({
          given: 'the shell links to a different paused workspace',
          should: 'check and restore that workspace explicitly',
          actual: [selectedWorkspace, restoredWorkspace],
          expected: ['https://widget.slack.com', 'https://widget.slack.com'],
        })
      },
    )
  },
)
