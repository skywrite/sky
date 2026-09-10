import path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'calendar polling waits, preserves meetings, and offers deliberate Keychain recovery', timeout: 60000 },
  async (t) => {
    const day = new PlainDate('2026-01-15')
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Day\n',
        tempPrefix: 'sky-keychain-browser-',
        file: path.posix.join('time', dayFile(day)),
        day: true,
      },
      async ({ page, origin, errors }) => {
        await page.clock.install()
        let reads = 0
        let release!: () => void
        let started!: () => void
        const began = new Promise<void>((resolve) => {
          started = resolve
        })
        const pending = new Promise<void>((resolve) => {
          release = resolve
        })
        const meeting = {
          title: 'Atlas sync',
          start: '10:00',
          end: '10:30',
          allDay: false,
          who: [],
          joinUrl: null,
          state: 'next',
          record: null,
        }
        await page.route('**/day/*/schedule', async (route) => {
          reads++
          if (reads === 2) {
            started()
            await pending
            await route.fulfill({
              json: { read: false, errors: ['Keychain access needs your attention.'], meetings: [] },
            })
          } else {
            await route.fulfill({
              json: {
                read: true,
                errors: [],
                meetings: [{ ...meeting, title: reads === 1 ? 'Atlas sync' : 'Widget review' }],
              },
            })
          }
        })
        await page.setViewportSize({ width: 1400, height: 900 })
        await page.goto(`${origin}/${day.ymd}`)
        const rail = page.locator('[data-section="meetings"]')
        await rail.getByText('Atlas sync', { exact: true }).waitFor()
        await page.clock.fastForward(60000)
        await began
        await page.clock.fastForward(20000)
        assert({
          given: 'an outstanding calendar refresh',
          should: 'keep one request in flight',
          actual: reads,
          expected: 2,
        })
        release()
        await rail.getByText('Showing the last available schedule.', { exact: false }).waitFor()
        assert({
          given: 'a denied refresh',
          should: 'keep the last meetings and link to recovery',
          actual: [
            await rail.getByText('Atlas sync', { exact: true }).count(),
            await rail.getByRole('link', { name: 'Connections' }).getAttribute('href'),
          ],
          expected: [1, '/settings/connections'],
        })
        await page.clock.fastForward(59000)
        assert({
          given: 'a settled failed request',
          should: 'wait a full minute before retrying',
          actual: reads,
          expected: 2,
        })
        await page.clock.fastForward(1000)
        await rail.getByText('Widget review', { exact: true }).waitFor()
        assert({
          given: 'access restored on the next refresh',
          should: 'show fresh meetings and clear the stale warning',
          actual: await rail.getByText('Showing the last available schedule.', { exact: false }).count(),
          expected: 0,
        })

        await page.route('**/settings/_api/settings', (route) =>
          route.fulfill({ json: { theme: 'light', textSize: 'default' } }),
        )
        await page.route('**/settings/_api/connections', (route) =>
          route.fulfill({
            json: {
              accessError: 'Keychain access needs your attention.',
              google: { client: true, accounts: [{ email: 'jane@example.com', grants: [] }], setup: [] },
              secrets: [],
            },
          }),
        )
        await page.route('**/settings/_api/connections/slack', (route) => route.fulfill({ json: { installed: false } }))
        let restores = 0
        let finish!: () => void
        await page.route('**/settings/_api/connections/restore', async (route) => {
          restores++
          await new Promise<void>((resolve) => {
            finish = resolve
          })
          await route.fulfill({ json: { ok: true } })
        })
        await page.goto(`${origin}/settings/connections`)
        const restore = page.getByRole('button', { name: 'Restore access', exact: true })
        await restore.click()
        await page.getByText('Complete the macOS Keychain prompt.', { exact: false }).waitFor()
        assert({
          given: 'an explicit recovery is pending',
          should: 'disable repeated clicks and keep the account visible',
          actual: [
            await restore.isDisabled(),
            restores,
            await page.getByText('jane@example.com', { exact: true }).count(),
          ],
          expected: [true, 1, 1],
        })
        finish()
        await page.getByText('Complete the macOS Keychain prompt.', { exact: false }).waitFor({ state: 'detached' })
        assert({
          given: 'the calendar and recovery interactions',
          should: 'raise no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
