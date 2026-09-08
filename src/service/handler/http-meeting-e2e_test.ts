import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { CalendarDraft, CalendarFields } from '#lib/calendarScheduler/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'meeting composer — review people and conflicts before sending, on desktop and mobile', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'sky-meeting-ui-', day: true },
      async ({ page, origin }) => {
        const sent: CalendarFields[] = []
        const jane = { id: 'jane', name: 'Jane Doe', hint: 'Atlas', emails: [] }
        const otherJane = { id: 'other-jane', name: 'Jane Smith', hint: 'Widget', emails: ['jane.smith@example.com'] }
        const taylor = { id: 'taylor', name: 'Taylor Morgan', hint: 'Atlas', emails: [] }
        const sam = {
          id: 'sam',
          name: 'Sam Rivera',
          hint: 'Atlas',
          emails: ['sam@example.com', 'sam.work@example.com', 'sam.team@example.com'],
        }
        const artifacts = env.get('SKY_MEETING_SCREENSHOTS')
        if (artifacts) await mkdir(artifacts, { recursive: true })
        const fields: CalendarFields = {
          title: 'Atlas review',
          date: '2030-05-03',
          time: '15:00',
          timezone: 'America/New_York',
          duration: 30,
          account: '',
          guests: [],
          description: '',
        }
        await page.route('**/clock/_api/now', (route) =>
          route.fulfill({
            json: {
              notebook: { date: '2030-05-01', time: '10:00', timezone: fields.timezone },
              system: { date: '2030-05-01', time: '10:00', timezone: fields.timezone },
            },
          }),
        )
        await page.route('**/meetings/_api/**', async (route) => {
          const url = new URL(route.request().url())
          if (url.pathname.endsWith('/setup'))
            return route.fulfill({
              json: { date: '2030-05-01', timezone: fields.timezone, accounts: ['organizer@example.com'] },
            })
          if (url.pathname.endsWith('/people')) return route.fulfill({ json: [taylor] })
          if (url.pathname.endsWith('/parse'))
            return route.fulfill({
              json: {
                fields,
                assumptions: ['Friday means 2030-05-03. Assuming 30 minutes.'],
                questions: [],
                unsupported: [],
                invitees: [
                  { query: 'Jane', candidates: [jane, otherJane], selected: null },
                  { query: 'Sam', candidates: [sam], selected: null },
                ],
              },
            })
          if (url.pathname.endsWith('/preview')) {
            const timing = route.request().postDataJSON() as CalendarFields
            return route.fulfill({
              json: {
                date: timing.date,
                timezone: timing.timezone,
                warnings: [],
                calendars: ['Work', 'Personal'],
                alternatives: timing.time === '15:00' ? ['14:30', '16:00'] : [],
                reviewKey: 'a'.repeat(64),
                events: [
                  {
                    id: 'planning',
                    title: 'Planning',
                    start: `${fields.date}T10:00:00-04:00`,
                    end: `${fields.date}T11:00:00-04:00`,
                    allDay: false,
                    calendar: 'Work',
                    busy: true,
                    conflict: false,
                  },
                  {
                    id: 'design',
                    title: 'Design review',
                    start: `${fields.date}T15:00:00-04:00`,
                    end: `${fields.date}T16:00:00-04:00`,
                    allDay: false,
                    calendar: 'Work',
                    busy: true,
                    conflict: timing.time === '15:00',
                  },
                ],
              },
            })
          }
          if (url.pathname.endsWith('/create')) {
            sent.push(route.request().postDataJSON().fields as CalendarFields)
            return route.fulfill({
              json: {
                id: 'test-request',
                state: 'created',
                result: {
                  title: fields.title,
                  calendarUrl: 'https://calendar.google.com/calendar/event?eid=example',
                  zoomUrl: 'https://example.com/zoom-meeting',
                },
              },
            })
          }
          return route.fulfill({ status: 404, json: { message: 'Unknown test route' } })
        })
        await page.setViewportSize({ width: 1440, height: 1100 })
        await page.goto(`${origin}/clock`)
        await page.getByRole('button', { name: '+ New meeting', exact: true }).click()
        await page.getByLabel('Who are we meeting?').fill('Meet Jane and Sam on Friday at 3 PM about Atlas')
        await page.getByText('1 scheduling conflict', { exact: true }).waitFor()
        const create = page.getByRole('button', { name: 'Create & send invites', exact: true })
        assert({
          given: 'a parsed draft with two possible Janes',
          should: 'show the conflict and require the person to be chosen without sending',
          actual: [await create.isDisabled(), sent.length],
          expected: [true, 0],
        })
        const samOptions = page.getByRole('group', { name: 'Sam Rivera', exact: true })
        assert({
          given: 'one matched contact with three addresses',
          should: 'show their identity once, group the email choices and avoid asking which person they are',
          actual: [
            await samOptions.getByText('Sam Rivera', { exact: true }).count(),
            await samOptions.getByRole('button').count(),
            await page.getByText('Who do you mean by “Sam”?', { exact: true }).count(),
          ],
          expected: [1, 3, 0],
        })
        if (artifacts) await samOptions.screenshot({ path: path.join(artifacts, 'meeting-email-choice-desktop.png') })
        await samOptions.getByRole('button', { name: 'Use sam@example.com for Sam Rivera', exact: true }).click()
        await page.getByRole('button', { name: /Jane Doe No email saved/ }).click()
        const janeEmail = page.getByLabel('Email for Jane Doe', { exact: true })
        await janeEmail.waitFor({ timeout: 5000 })
        assert({
          given: 'a chosen person without a saved email',
          should: 'focus their email field and keep sending disabled',
          actual: [await janeEmail.evaluate((input) => input === document.activeElement), await create.isDisabled()],
          expected: [true, true],
        })
        const janeCard = page.locator('.sky-meeting-guest').filter({ has: janeEmail })
        await janeCard.getByRole('button', { name: 'Change', exact: true }).click()
        await page.getByRole('button', { name: /Jane Smith jane.smith@example.com/ }).click()
        const selectedJane = page.locator('.sky-meeting-guest').filter({ hasText: 'jane.smith@example.com' })
        await selectedJane.getByRole('button', { name: 'Change', exact: true }).click()
        await page.getByRole('button', { name: /Jane Doe No email saved/ }).click()
        await janeEmail.fill('not-an-email')
        assert({
          given: 'an incomplete email for the chosen person',
          should: 'require a usable address before resolving the invitee',
          actual: await page.getByRole('button', { name: 'Use email', exact: true }).isDisabled(),
          expected: true,
        })
        await janeEmail.fill('jane@example.com')
        await page.getByRole('button', { name: 'Use email', exact: true }).click()
        await page
          .getByRole('button', { name: 'Create & send invites', exact: true })
          .and(page.locator(':not([disabled])'))
          .waitFor()
        if (artifacts) {
          await page.screenshot({ path: path.join(artifacts, 'meeting-desktop.png'), animations: 'disabled' })
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(
          () => document.querySelector('[role="dialog"]')?.getBoundingClientRect().width === 390,
        )
        if (artifacts)
          await page.screenshot({ path: path.join(artifacts, 'meeting-mobile.png'), animations: 'disabled' })
        const layout = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          footer: document.querySelector('.sky-meeting-footer')!.getBoundingClientRect().bottom,
          dialog: document.querySelector('[role="dialog"]')!.getBoundingClientRect().height,
        }))
        assert({
          given: 'the same meeting on a narrow phone',
          should: 'fill the screen without horizontal overflow and keep the action footer in view',
          actual: [layout.width, layout.footer <= 844, layout.dialog],
          expected: [390, true, 844],
        })
        await page.getByRole('button', { name: '1 conflict · Review your day', exact: true }).click()
        const afterReview = await page.locator('.sky-meeting-footer').boundingBox()
        assert({
          given: 'the mobile shortcut to the day',
          should: 'scroll only the meeting body and keep the footer on screen',
          actual: !!afterReview && afterReview.y >= 0 && afterReview.y + afterReview.height <= 845,
          expected: true,
        })
        if (artifacts)
          await page.screenshot({ path: path.join(artifacts, 'meeting-mobile-day.png'), animations: 'disabled' })
        await page.getByRole('button', { name: '2:30 PM', exact: true }).click()
        await page.getByText('This time is clear', { exact: true }).waitFor()
        const samCard = page.locator('.sky-meeting-guest').filter({ hasText: 'Sam Rivera' })
        await samCard.getByRole('button', { name: 'Change', exact: true }).click()
        assert({
          given: 'changing an invite address on a phone',
          should: 'offer the same three choices under one name and wait for the new address',
          actual: [
            await samOptions.getByText('Sam Rivera', { exact: true }).count(),
            await samOptions.getByRole('button').count(),
            await create.isDisabled(),
            sent.length,
          ],
          expected: [1, 3, true, 0],
        })
        if (artifacts) await samOptions.screenshot({ path: path.join(artifacts, 'meeting-email-choice-mobile.png') })
        await samOptions.getByRole('button', { name: 'Use sam.work@example.com for Sam Rivera', exact: true }).click()
        await page.getByLabel('Add invitees', { exact: true }).fill('Taylor')
        await page.getByRole('button', { name: /Taylor Morgan No email saved/ }).click()
        const taylorEmail = page.getByLabel('Email for Taylor Morgan', { exact: true })
        await taylorEmail.waitFor()
        assert({
          given: 'a contact without an email selected from search on a phone',
          should: 'open email entry immediately without asking to choose the same person again',
          actual: [
            await taylorEmail.evaluate((input) => input === document.activeElement),
            await page.getByRole('button', { name: /Taylor Morgan No email saved/ }).count(),
            await create.isDisabled(),
            sent.length,
          ],
          expected: [true, 0, true, 0],
        })
        await taylorEmail.fill('taylor@example.com')
        await taylorEmail.press('Enter')
        await page.getByLabel('Add invitees', { exact: true }).fill('new@example.com')
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        await page.getByLabel('Who are we meeting?').fill('Meet Jane and Sam on Friday at 3 PM about Atlas, updated')
        assert({
          given: 'changed wording after a draft is reviewed',
          should: 'prevent sending stale details',
          actual: [await create.isDisabled(), sent.length],
          expected: [true, 0],
        })
        await page.getByLabel('Who are we meeting?').fill('Meet Jane and Sam on Friday at 3 PM about Atlas')
        await create.click()
        await page.getByRole('heading', { name: 'Meeting scheduled', exact: true }).waitFor()
        assert({
          given: 'chosen people, manually supplied emails and a free time',
          should: 'preserve the chosen names and send the reviewed meeting only on the final action',
          actual: [sent.length, sent[0]?.time, sent[0]?.guests],
          expected: [
            1,
            '14:30',
            [
              { name: 'Jane Doe', email: 'jane@example.com' },
              { name: 'Sam Rivera', email: 'sam.work@example.com' },
              { name: 'Taylor Morgan', email: 'taylor@example.com' },
              { name: 'new@example.com', email: 'new@example.com' },
            ],
          ],
        })
      },
    )
  },
)

test(
  { name: 'meeting composer — live AI updates preserve choices and ignore superseded responses', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'sky-meeting-live-', day: true },
      async ({ page, origin, errors }) => {
        const oldStarted = Promise.withResolvers<void>()
        const latestStarted = Promise.withResolvers<void>()
        const releaseOld = Promise.withResolvers<void>()
        const releaseLatest = Promise.withResolvers<void>()
        const oldFinished = Promise.withResolvers<void>()
        let retryFails = true
        let sends = 0
        const person = {
          id: 'sam',
          name: 'Sam Rivera',
          hint: 'Atlas',
          emails: ['sam@example.com', 'sam.work@example.com'],
        }
        const draft = (time: string, duration = 30): CalendarDraft => ({
          fields: {
            title: 'Meeting with Sam',
            date: '2030-05-03',
            time,
            timezone: 'America/New_York',
            duration,
            account: '',
            guests: [],
            description: '',
          },
          invitees: [{ query: 'Sam', candidates: [person], selected: null }],
          assumptions: [],
          questions: [],
          unsupported: [],
        })
        await page.route('**/clock/_api/now', (route) =>
          route.fulfill({
            json: {
              notebook: { date: '2030-05-03', time: '10:00', timezone: 'America/New_York' },
              system: { date: '2030-05-03', time: '10:00', timezone: 'America/New_York' },
            },
          }),
        )
        await page.route('**/meetings/_api/**', async (route) => {
          const url = new URL(route.request().url())
          if (url.pathname.endsWith('/setup'))
            return route.fulfill({
              json: {
                date: '2030-05-03',
                timezone: 'America/New_York',
                accounts: ['organizer@example.com'],
              },
            })
          if (url.pathname.endsWith('/people')) return route.fulfill({ json: [] })
          if (url.pathname.endsWith('/parse')) {
            const { query } = route.request().postDataJSON() as { query: string }
            if (query === 'Meet Sam at 4 PM') {
              oldStarted.resolve()
              await releaseOld.promise
              await route.fulfill({ json: draft('16:00') })
              oldFinished.resolve()
              return
            }
            if (query === 'Meet Sam at 5 PM for 90 minutes') {
              latestStarted.resolve()
              await releaseLatest.promise
              return route.fulfill({ json: draft('17:00', 90) })
            }
            if (query === 'Meet Sam at 6 PM' && retryFails) {
              retryFails = false
              return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable.' } })
            }
            const time = query === 'Meet Sam' ? '' : query === 'Meet Sam at 3 PM' ? '15:00' : '18:00'
            return route.fulfill({ json: draft(time) })
          }
          if (url.pathname.endsWith('/preview')) {
            const timing = route.request().postDataJSON() as CalendarFields
            return route.fulfill({
              json: {
                date: timing.date,
                timezone: timing.timezone,
                events: [],
                warnings: [],
                calendars: ['Work'],
                alternatives: [],
                reviewKey: 'a'.repeat(64),
              },
            })
          }
          if (url.pathname.endsWith('/create')) sends++
          return route.fulfill({ status: 404, json: { message: 'Unknown test route' } })
        })
        await page.goto(`${origin}/clock`)
        await page.getByRole('button', { name: '+ New meeting', exact: true }).click()
        const wording = page.getByLabel('Who are we meeting?')
        const time = page.getByLabel('Time', { exact: true })
        const minutes = page.getByLabel('Minutes', { exact: true })
        const create = page.getByRole('button', { name: 'Create & send invites', exact: true })
        const waitForTime = (value: string) =>
          page.waitForFunction(
            (expected) => document.querySelector<HTMLInputElement>('input[type="time"]')?.value === expected,
            value,
          )
        await wording.fill('Meet Sam')
        await page.getByRole('button', { name: 'Use sam.work@example.com for Sam Rivera', exact: true }).click()
        assert({
          given: 'only a name typed into the meeting prompt',
          should: 'show the person automatically while leaving the unfinished time empty',
          actual: [await time.inputValue(), await create.isDisabled()],
          expected: ['', true],
        })
        await page.getByLabel('Meeting title', { exact: true }).fill('Atlas planning')
        await minutes.fill('45')
        await page.getByLabel('Add invitees', { exact: true }).fill('extra@example.com')
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        await wording.fill('Meet Sam at 3 PM')
        await waitForTime('15:00')
        assert({
          given: 'a time added after choosing an email and editing the draft',
          should: 'update automatically while retaining the chosen email, extra guest, title and duration',
          actual: [
            await minutes.inputValue(),
            await page.getByLabel('Meeting title', { exact: true }).inputValue(),
            await page.locator('.sky-meeting-guest').count(),
            await page.locator('.sky-meeting-guest').first().getByText('sam.work@example.com', { exact: true }).count(),
          ],
          expected: ['45', 'Atlas planning', 2, 1],
        })
        await wording.fill('Meet Sam at 4 PM')
        await oldStarted.promise
        await wording.fill('Meet Sam at 5 PM for 90 minutes')
        await latestStarted.promise
        await minutes.fill('60')
        releaseLatest.resolve()
        await waitForTime('17:00')
        releaseOld.resolve()
        await oldFinished.promise
        // Let a superseded response's fetch callbacks run if the browser delivers them.
        await page.waitForTimeout(100)
        assert({
          given: 'out-of-order responses and an edit made while the latest request is pending',
          should: 'keep the newest time and the manual duration without sending',
          actual: [await time.inputValue(), await minutes.inputValue(), sends],
          expected: ['17:00', '60', 0],
        })
        await wording.fill('Meet Sam at 6 PM')
        await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
        assert({
          given: 'an AI failure after changing the wording',
          should: 'retain the review and block sending stale details',
          actual: [await time.inputValue(), await create.isDisabled()],
          expected: ['17:00', true],
        })
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await waitForTime('18:00')
        await create.and(page.locator(':not([disabled])')).waitFor()
        assert({
          given: 'a successful retry',
          should: 'restore a ready draft with no automatic invitation',
          actual: [sends, errors.filter((error) => !error.includes('503'))],
          expected: [0, []],
        })
      },
    )
  },
)
