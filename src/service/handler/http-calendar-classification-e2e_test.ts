import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { DaySchedule, ScheduledMeeting } from './day/schedule.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const MEETINGS = '.sky-rail [data-section="meetings"]'
const NOTICES = '.sky-rail [data-section="family-&-reminders"]'

test(
  {
    name: 'calendar rail hides notifications when enabled and retains corrections and refresh behavior',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown:
          '---\ncreated: 2026-01-27 07:00\n---\n\n# Day\n\n## Most important\n\n- Review the Atlas plan\n',
        tempPrefix: 'sky-calendar-rail-',
        file: path.posix.join('time', dayFile(DAY)),
        day: true,
      },
      async ({ page, origin, errors }) => {
        const noticeKey = 'a'.repeat(64)
        const meetingKey = 'b'.repeat(64)
        const row = (key: string, title: string, type: 'meeting' | 'notification' | 'uncertain'): ScheduledMeeting => ({
          title,
          start: '09:00',
          end: '10:00',
          allDay: false,
          who: ['Jane Doe'],
          joinUrl: null,
          state: 'past',
          record: null,
          classification: { key, type, source: 'automatic' },
          calendarUrl: 'https://calendar.google.com/calendar/event?eid=mock',
        })
        const events = [
          row(meetingKey, 'Atlas sync', 'meeting'),
          row(noticeKey, 'School closure', 'notification'),
          row('c'.repeat(64), 'Catch up', 'uncertain'),
        ]
        const overrides = new Map<string, 'meeting' | 'notification'>()
        let failSave = false
        let failRead = false
        let noticesOnly = false
        let hideNotifications = true
        let sortingFailed = true
        let reads = 0
        await page.route('**/day/*/schedule', async (route) => {
          reads += 1
          if (failRead) return route.fulfill({ status: 503, json: { message: 'Calendar unavailable' } })
          const classified = (noticesOnly ? events.slice(1, 2) : events).map((entry) => {
            const manual = overrides.get(entry.classification!.key)
            return manual
              ? { ...entry, classification: { ...entry.classification!, type: manual, source: 'manual' as const } }
              : entry
          })
          const schedule: DaySchedule = {
            read: true,
            errors: [],
            meetings: classified.filter((entry) => entry.classification?.type !== 'notification'),
            notifications: classified.filter((entry) => entry.classification?.type === 'notification'),
            hideNotifications,
            ...(sortingFailed
              ? { classificationWarning: 'Calendar sorting timed out. Unsorted events remain in Meetings.' }
              : {}),
          }
          await route.fulfill({ json: schedule })
        })
        await page.route('**/day/*/schedule/type', async (route) => {
          if (failSave)
            return route.fulfill({ status: 500, json: { message: 'Could not save the event type. Try again.' } })
          const { key, type } = route.request().postDataJSON() as {
            key: string
            type: 'meeting' | 'notification' | null
          }
          if (type === null) overrides.delete(key)
          else overrides.set(key, type)
          await route.fulfill({ json: { ok: true } })
        })
        const refresh = () =>
          page.evaluate(
            (ymd) => window.dispatchEvent(new CustomEvent('sky:schedule-changed', { detail: ymd })),
            DAY.ymd,
          )
        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.locator(`${MEETINGS} .sky-dr-label`).first().waitFor()
        assert({
          given: 'the setting to hide family notifications and reminders is checked',
          should: 'show only meetings and omit both the notification entries and their section',
          actual: [
            await page.locator(`${MEETINGS} .sky-rail-count`).innerText(),
            await page.locator(NOTICES).count(),
            await page.getByText('School closure', { exact: true }).count(),
          ],
          expected: ['2', 0, 0],
        })
        const screenshots = env.get('SKY_CALENDAR_SCREENSHOTS')
        if (screenshots) await page.screenshot({ path: path.join(screenshots, 'calendar-meetings-only.png') })
        hideNotifications = false
        await refresh()
        await page.locator(`${NOTICES} .sky-dr-label`).waitFor()
        assert({
          given: 'the setting is unchecked with a meeting, a notification and an uncertain event',
          should: 'show notifications again without repeated uncertainty labels or a large sorting warning',
          actual: [
            await page.locator(`${MEETINGS} .sky-rail-count`).innerText(),
            await page
              .locator(NOTICES)
              .innerText()
              .then((text) => text.includes('no record')),
            await page.locator(`${NOTICES} [data-meeting-drop]`).count(),
            await page.getByText('Type uncertain · kept in Meetings').count(),
            await page.getByRole('button', { name: 'Retry calendar sorting' }).count(),
            await page.locator(`${MEETINGS} .sky-rail-empty`).count(),
          ],
          expected: ['2', false, 0, 0, 1, 0],
        })

        sortingFailed = false
        const beforeRetry = reads
        await page.getByRole('button', { name: 'Retry calendar sorting' }).click()
        await page.getByRole('button', { name: 'Retry calendar sorting' }).waitFor({ state: 'detached' })
        assert({
          given: 'calendar sorting is available again',
          should: 'refresh immediately from the compact retry action and clear it after recovery',
          actual: reads > beforeRetry,
          expected: true,
        })

        if (screenshots) await page.screenshot({ path: path.join(screenshots, 'calendar-rail.png') })

        await page.getByRole('button', { name: 'Change type for Catch up', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Dismiss', exact: true }).click()
        await page.locator(`${NOTICES} .sky-dr-label`, { hasText: 'Catch up' }).waitFor()
        await refresh()
        await page.waitForResponse((response) => response.url().endsWith('/schedule'))
        assert({
          given: 'the owner dismisses an uncertain event and the calendar refreshes',
          should: 'save it as a reminder, remove its missing-record expectation, and offer Undo',
          actual: [
            overrides.get('c'.repeat(64)),
            await page.locator(`${MEETINGS} .sky-dr-label`, { hasText: 'Catch up' }).count(),
            await page.getByRole('button', { name: 'Undo', exact: true }).count(),
          ],
          expected: ['notification', 0, 1],
        })
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await page.locator(`${MEETINGS} .sky-dr-label`, { hasText: 'Catch up' }).waitFor()
        assert({
          given: 'Undo after dismissing an automatically classified event',
          should: 'remove the correction so automatic classification applies again',
          actual: overrides.size,
          expected: 0,
        })

        await page.locator(`${NOTICES} .sky-dr-label`).evaluate((node) => {
          const selection = window.getSelection()!
          const range = document.createRange()
          range.selectNodeContents(node)
          selection.removeAllRanges()
          selection.addRange(range)
        })
        const previousReads = reads
        await refresh()
        await page.waitForResponse((response) => response.url().endsWith('/schedule'))
        assert({
          given: 'selected event text during an unchanged schedule refresh',
          should: 'preserve the selected text',
          actual: [reads > previousReads, await page.evaluate(() => window.getSelection()?.toString())],
          expected: [true, 'School closure'],
        })

        await page.getByRole('button', { name: 'Change type for School closure' }).click()
        await page.getByRole('menuitem', { name: 'Meeting', exact: true }).click()
        await page.locator(`${MEETINGS} .sky-dr-label`, { hasText: 'School closure' }).waitFor()
        await page.reload()
        await page.locator(`${MEETINGS} .sky-dr-label`, { hasText: 'School closure' }).waitFor()
        await page.getByRole('button', { name: 'Change type for School closure' }).click()
        await page.getByRole('menuitem', { name: 'Use automatic classification' }).click()
        await page.locator(`${NOTICES} .sky-dr-label`).waitFor()

        await page.setViewportSize({ width: 390, height: 900 })
        const showDetails = page.getByRole('button', { name: 'Show details' })
        await showDetails.click()
        hideNotifications = true
        await refresh()
        await page.locator(NOTICES).waitFor({ state: 'detached' })
        assert({
          given: 'the setting is checked on a phone',
          should: 'hide notifications and keep the meetings visible',
          actual: [
            await page.locator(`${MEETINGS} .sky-rail-count`).innerText(),
            await page.getByText('School closure', { exact: true }).count(),
          ],
          expected: ['2', 0],
        })
        await page.getByRole('button', { name: 'Change type for Catch up', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Dismiss', exact: true }).click()
        await page.locator(`${MEETINGS} .sky-dr-label`, { hasText: 'Catch up' }).waitFor({ state: 'detached' })
        await page.reload()
        await page.getByRole('button', { name: 'Show details' }).click()
        await page.locator(`${MEETINGS} .sky-dr-label`).waitFor()
        assert({
          given: 'a dismissed event with reminders hidden and a page reload on a phone',
          should: 'keep the saved reminder out of Meetings',
          actual: [
            await page.locator(`${MEETINGS} .sky-rail-count`).innerText(),
            await page.getByText('Catch up', { exact: true }).count(),
          ],
          expected: ['1', 0],
        })
        overrides.delete('c'.repeat(64))
        hideNotifications = false
        await refresh()
        await page.locator(`${NOTICES} .sky-dr-label`).waitFor()
        await page.getByRole('button', { name: 'Change type for School closure' }).click()
        await page.getByRole('menuitem', { name: 'Open in Google Calendar' }).waitFor()
        await page.getByRole('menuitem', { name: 'Meeting', exact: true }).click()
        await page.locator(`${MEETINGS} .sky-dr-label`, { hasText: 'School closure' }).waitFor()
        await page.getByRole('button', { name: 'Change type for School closure' }).click()
        await page.getByRole('menuitem', { name: 'Use automatic classification' }).click()
        await page.locator(`${NOTICES} .sky-dr-label`).waitFor()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
        if (screenshots) await page.screenshot({ path: path.join(screenshots, 'calendar-phone.png') })
        await page.keyboard.press('Escape')
        assert({
          given: 'the notification menu on a phone',
          should: 'keep corrections and the source event accessible without horizontal overflow',
          actual: overflow,
          expected: false,
        })
        await page.setViewportSize({ width: 1400, height: 1000 })

        failSave = true
        await page.getByRole('button', { name: 'Change type for School closure' }).click()
        await page.getByRole('menuitem', { name: 'Meeting', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Could not save the event type' }).waitFor()
        assert({
          given: 'a rejected manual correction',
          should: 'keep the notification in place and show the save failure',
          actual: [await page.locator(`${NOTICES} .sky-dr-label`).innerText(), overrides.size],
          expected: ['School closure', 0],
        })

        noticesOnly = true
        await refresh()
        await page.getByText('No meetings.', { exact: true }).waitFor()
        failRead = true
        await refresh()
        await page.getByText('Showing the last available schedule.', { exact: false }).waitFor()
        assert({
          given: 'a day containing only notifications followed by a failed refresh',
          should: 'retain the notifications and label the stale schedule',
          actual: [await page.locator(`${NOTICES} .sky-dr-label`).innerText(), errors],
          expected: [
            'School closure',
            [
              'console: Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
              'console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
            ],
          ],
        })
        failRead = false
        hideNotifications = true
        await refresh()
        await page.locator(NOTICES).waitFor({ state: 'detached' })
        await page.getByText('No meetings.', { exact: true }).waitFor()
        await page.reload()
        await page.getByText('No meetings.', { exact: true }).waitFor()
        assert({
          given: 'a day with only notifications, hiding enabled, and a page reload',
          should: 'keep the rail empty of family entries and their heading',
          actual: [await page.locator(NOTICES).count(), await page.locator('.sky-rail .sky-dr-item').count()],
          expected: [0, 0],
        })
      },
    )
  },
)
