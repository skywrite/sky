import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { CalendarFields } from '#lib/calendarScheduler/types.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { CALENDAR_FIELDS, calendarApprovalTestHost } from './chat/calendarApprovalTestHelpers.ts'
import type { ToolRun } from './chat/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { CalendarBrowserConnection } from './meetings/browserSignIn.ts'

test(
  { name: 'a failed send retries the edited recurring draft in the same card across reloads', timeout: 60000 },
  async (t) => {
    let host: ReturnType<typeof calendarApprovalTestHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock calendar notebook\n',
        tempPrefix: 'sky-calendar-recovery-ui-',
        day: true,
        chat: (root) => {
          host = calendarApprovalTestHost(root)
          return host.chat
        },
      },
      async ({ page, origin, errors }) => {
        let retries = 0
        let delayReceipt = true
        let pauseStatus = false
        let releaseStatus: (() => void) | undefined
        let signedIn = false
        let windows = 0
        let completeSignIn!: () => void
        const connection = new CalendarBrowserConnection(
          {
            check: async () => signedIn,
            signIn: async (_account, signal, opened) => {
              windows++
              opened()
              await new Promise<void>((resolve, reject) => {
                completeSignIn = () => {
                  signedIn = true
                  resolve()
                }
                signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
              })
            },
          },
          () => () => {},
        )
        await page.route('**/meetings/_api/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/setup'))
            return route.fulfill({ json: { ...(await host.scheduler.setup()), browserSignIn: true } })
          if (pathname.endsWith('/browser')) return route.fulfill({ json: connection.status(CALENDAR_FIELDS.account) })
          if (pathname.endsWith('/browser/check'))
            return route.fulfill({ json: connection.status(CALENDAR_FIELDS.account, true) })
          if (pathname.endsWith('/browser/sign-in'))
            return route.fulfill({ json: connection.signIn(CALENDAR_FIELDS.account) })
          if (pathname.endsWith('/browser/cancel'))
            return route.fulfill({ json: connection.cancel(CALENDAR_FIELDS.account) })
          if (pathname.endsWith('/preview'))
            return route.fulfill({ json: await host.scheduler.preview(route.request().postDataJSON()) })
          if (pathname.endsWith('/retry-review'))
            return route.fulfill({ json: await host.scheduler.retryReview(route.request().postDataJSON().draftId) })
          if (pathname.endsWith('/retry')) {
            retries++
            const job = await host.scheduler.retry(route.request().postDataJSON())
            return route.fulfill({
              status: 202,
              json: delayReceipt ? { ...job, state: 'creating', message: undefined, recovery: undefined } : job,
            })
          }
          if (pathname.includes('/jobs/')) {
            if (pauseStatus) {
              pauseStatus = false
              await new Promise<void>((resolve) => {
                releaseStatus = resolve
              })
            }
            const job = await host.scheduler.get(pathname.split('/').at(-1)!)
            return route.fulfill({
              status: job ? 200 : 404,
              json:
                job && retries && delayReceipt
                  ? { ...job, state: 'creating', message: undefined, recovery: undefined }
                  : (job ?? {}),
            })
          }
          return route.fulfill({ json: [] })
        })
        const prepared = await host.scheduler.review({
          fields: { ...CALENDAR_FIELDS, recurrence: { frequency: 'weekly', interval: 1, ends: { type: 'never' } } },
        })
        host.setDraftIds([prepared.draftId!])
        host.setFailure('sign_in')
        const response = await fetch(`${origin}/chat/recovery/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Schedule weekly Atlas planning.',
            profile: 'test',
            contextTokens: 0,
            saves: false,
          }),
        })
        const stream = response.text()
        if (!response.ok) throw new Error(await stream)
        try {
          await page.setViewportSize({ width: 1440, height: 1300 })
          await page.goto(`${origin}/thread/recovery`)
          const card = page.getByRole('region', { name: 'Meeting draft', exact: true })
          await card.getByRole('button', { name: 'Edit', exact: true }).click()
          await card.getByLabel('Meeting title', { exact: true }).fill('Atlas launch review')
          await card.getByLabel('Time', { exact: true }).fill('16:15')
          await card.getByLabel('Minutes', { exact: true }).fill('45')
          await card.locator('.sky-meeting-description summary').click()
          await card.getByLabel('Agenda or note', { exact: true }).fill('Review the revised launch proposal.')
          await card.getByLabel('Repeat every', { exact: true }).fill('2')
          await card
            .getByRole('button', { name: 'Save changes', exact: true })
            .and(page.locator(':not([disabled])'))
            .click()
          await card.getByRole('heading', { name: 'Atlas launch review', exact: true }).waitFor()
          await card.getByRole('button', { name: 'Sign in to Google', exact: true }).waitFor()
          assert({
            given: 'an edited invitation while the Google browser is signed out',
            should: 'offer sign-in before sending and keep the creation action disabled',
            actual: [
              await card.getByRole('button', { name: 'Create series & send invites', exact: true }).isDisabled(),
              windows,
              host.sent.length,
            ],
            expected: [true, 0, 0],
          })
          await card.getByRole('button', { name: 'Sign in to Google', exact: true }).click()
          await card.getByText('Finish signing in to Google', { exact: true }).waitFor()
          await page.reload()
          await card.getByRole('button', { name: 'Cancel sign-in', exact: true }).click()
          await card.getByRole('button', { name: 'Sign in to Google', exact: true }).click()
          await card.getByText('Finish signing in to Google', { exact: true }).waitFor()
          completeSignIn()
          await card.getByText('Signed in to Google', { exact: true }).waitFor()
          assert({
            given: 'sign-in, a page reload, cancellation and a successful second sign-in',
            should: 'preserve the same edited card and create no invitation from authentication alone',
            actual: [
              windows,
              host.sent.length,
              await card.getByRole('heading', { name: 'Atlas launch review', exact: true }).count(),
            ],
            expected: [2, 0, 1],
          })
          signedIn = false
          await card.getByRole('button', { name: 'Create series & send invites', exact: true }).click()
          await card.getByText('The event wasn’t created', { exact: true }).waitFor()
          await stream
          await page.reload()
          await card.getByRole('button', { name: 'Sign in to Google', exact: true }).waitFor()
          await card.getByRole('button', { name: 'Review saved draft', exact: true }).waitFor()
          const history = card.locator('.sky-calendar-history')
          await history.getByText('Previous attempt failed', { exact: false }).waitFor()
          assert({
            given:
              'a human-edited subject, start time, duration, agenda and repeat interval, followed by a sign-in failure and reload',
            should: 'retain every edit in one failed card without constructing or sending a replacement',
            actual: [
              await card.count(),
              await card.getByRole('heading', { name: 'Atlas launch review', exact: true }).count(),
              await card.getByText('4:15 PM · 45 min', { exact: true }).count(),
              await card.getByText('Every 2 weeks on Friday · No end date', { exact: true }).count(),
              await card.locator('.sky-calendar-agenda').innerText(),
              host.sent.length,
              retries,
              await card.getByRole('alert').count(),
              await history.getAttribute('open'),
              (await history.locator('summary').innerText()).includes('2030-05-01'),
            ],
            expected: [1, 1, 1, 1, 'Review the revised launch proposal.', 0, 0, 0, null, true],
          })
          const artifacts = env.get('SKY_CALENDAR_SCREENSHOTS')
          if (artifacts) {
            await mkdir(artifacts, { recursive: true })
            await card.screenshot({ path: path.join(artifacts, 'calendar-failed-edits.png') })
          }
          await page.setViewportSize({ width: 390, height: 844 })
          await card.getByRole('button', { name: 'Sign in to Google', exact: true }).click()
          await card.getByText('Finish signing in to Google', { exact: true }).waitFor()
          completeSignIn()
          await card.getByText('Signed in to Google', { exact: true }).waitFor()
          await card.getByText('Ready to retry your saved draft', { exact: true }).waitFor()
          host.setFailure('repeat')
          host.setWarning('Could not check Personal.')
          await card.getByRole('button', { name: 'Review saved draft', exact: true }).click()
          await card.getByText('Could not check Personal.', { exact: true }).waitFor()
          assert({
            given: 'an explicit recovery review with refreshed availability on a phone',
            should: 'show the changed warning while preserving the edited invitation and awaiting approval',
            actual: [
              await card.getByRole('button', { name: 'Retry & send invites', exact: true }).count(),
              await card.getByRole('heading', { name: 'Atlas launch review', exact: true }).count(),
              await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
              host.sent.length,
              retries,
            ],
            expected: [1, 1, true, 0, 0],
          })
          if (artifacts) await card.screenshot({ path: path.join(artifacts, 'calendar-retry-review.png') })
          await card.getByRole('button', { name: 'Retry & send invites', exact: true }).click()
          await card.locator('header').getByText('Creating series…', { exact: true }).waitFor()
          assert({
            given: 'a retry in progress after Google sign-in',
            should: 'show creation progress without claiming success or offering another retry',
            actual: [
              await card.getByText('Series created · Invitations sent', { exact: true }).count(),
              await card.getByRole('button', { name: 'Review saved draft', exact: true }).count(),
              host.sent.length,
            ],
            expected: [0, 0, 0],
          })
          delayReceipt = false
          const repeatFailure = card
            .getByRole('alert')
            .filter({ hasText: 'Calendar did not keep the requested repeat schedule.' })
          await repeatFailure.waitFor()
          await card.getByRole('region', { name: 'Google browser sign-in', exact: true }).waitFor({ state: 'hidden' })
          assert({
            given: 'a failed retry that was started on this page',
            should: 'announce the new error immediately',
            actual: await card.locator('header').getByText('Not created', { exact: true }).count(),
            expected: 1,
          })
          await page.reload()
          await history.locator('summary').waitFor()
          await card.getByRole('region', { name: 'Google browser sign-in', exact: true }).waitFor({ state: 'hidden' })
          const failureTime = await history.locator('summary').innerText()
          pauseStatus = true
          await page.reload()
          await card.getByText('Checking saved result…', { exact: true }).waitFor()
          assert({
            given: 'a refresh while the saved status is still loading',
            should: 'check the existing result without showing an active creation or an error',
            actual: [
              await card.getByText('Creating series…', { exact: true }).count(),
              await card.getByRole('alert').count(),
              retries,
            ],
            expected: [0, 0, 1],
          })
          releaseStatus?.()
          await history.locator('summary').waitFor()
          assert({
            given: 'a failed attempt followed by repeated page refreshes without pressing anything',
            should: 'restore a saved draft with collapsed, timestamped history and no fresh error or send',
            actual: [
              await card.locator('header').getByText('Saved draft', { exact: true }).count(),
              await card.getByRole('heading', { name: 'Atlas launch review', exact: true }).count(),
              await card.getByText('4:15 PM · 45 min', { exact: true }).count(),
              host.sent.length,
              retries,
              windows,
              await card.getByRole('alert').count(),
              await history.getAttribute('open'),
              (await history.locator('summary').innerText()) === failureTime,
              await history
                .getByText('Calendar did not keep the requested repeat schedule. Nothing was saved.', { exact: true })
                .isVisible(),
            ],
            expected: [1, 1, 1, 0, 1, 3, 0, null, true, false],
          })
          await history.locator('summary').click()
          await history
            .getByText('Calendar did not keep the requested repeat schedule. Nothing was saved.', { exact: true })
            .waitFor()
          await history.locator('summary').click()
          if (artifacts) await card.screenshot({ path: path.join(artifacts, 'calendar-retry-failed.png') })
          host.setFailure(undefined)
          await card.getByRole('button', { name: 'Review saved draft', exact: true }).click()
          await card.getByRole('button', { name: 'Retry & send invites', exact: true }).click()
          await card.getByText('Series created · Invitations sent', { exact: true }).waitFor()
          await page.reload()
          await card.getByText('Series created · Invitations sent', { exact: true }).waitFor()
          assert({
            given: 'one explicit retry and a second reload',
            should: 'create the exact edited series once and retain its success in the original card',
            actual: [
              await card.count(),
              host.sent,
              retries,
              await card.getByRole('button', { name: 'Review saved draft', exact: true }).count(),
              errors,
            ],
            expected: [
              1,
              [
                {
                  ...CALENDAR_FIELDS,
                  title: 'Atlas launch review',
                  time: '16:15',
                  duration: 45,
                  description: 'Review the revised launch proposal.',
                  recurrence: { frequency: 'weekly', interval: 2, ends: { type: 'never' } },
                },
              ],
              2,
              0,
              [],
            ],
          })
        } finally {
          releaseStatus?.()
          await page.request.post(`${origin}/chat/recovery/stop`, { data: {} })
          await stream
        }
      },
    )
  },
)

test(
  {
    name: 'multi-event review shows one meeting, edits the selected date, and sends the exact reviewed batch',
    timeout: 60000,
  },
  async (t) => {
    let host: ReturnType<typeof calendarApprovalTestHost>
    const artifacts = env.get('SKY_CALENDAR_SCREENSHOTS')
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock calendar notebook\n',
        tempPrefix: 'sky-calendar-batch-ui-',
        day: true,
        chat: (root) => {
          host = calendarApprovalTestHost(root)
          return host.chat
        },
      },
      async ({ page, origin, errors }) => {
        await page.route('**/meetings/_api/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/setup')) return route.fulfill({ json: await host.scheduler.setup() })
          if (pathname.endsWith('/preview'))
            return route.fulfill({ json: await host.scheduler.preview(route.request().postDataJSON()) })
          if (pathname.includes('/jobs/')) {
            const job = await host.scheduler.get(pathname.split('/').at(-1)!)
            return route.fulfill({ status: job ? 200 : 404, json: job ?? { message: 'No job yet.' } })
          }
          return route.fulfill({ json: [] })
        })
        for (const width of [1440, 390]) {
          const drafts = await Promise.all(
            Array.from({ length: 12 }, (_, index) =>
              host.scheduler.review({
                fields: { ...CALENDAR_FIELDS, date: new PlainDate(CALENDAR_FIELDS.date).addDays(index).ymd },
              }),
            ),
          )
          host.setDraftIds(drafts.map((draft) => draft.draftId!))
          const id = `batch-${width}`
          const response = await fetch(`${origin}/chat/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Schedule the listed Atlas sessions.',
              profile: 'test',
              contextTokens: 0,
              saves: false,
            }),
          })
          const stream = response.text()
          if (!response.ok) throw new Error(await stream)
          try {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 })
            await page.goto(`${origin}/thread/${id}`)
            const card = page.getByRole('region', { name: 'Meeting drafts', exact: true })
            await card.getByRole('heading', { name: 'Atlas planning', exact: true }).waitFor()
            const dates = card.getByRole('group', { name: 'Events in this request' })
            assert({
              given: `twelve explicitly requested events at ${width}px`,
              should: 'show one bounded review card, one set of guest details, and the exact send count',
              actual: [
                await dates.getByRole('button').count(),
                await card.locator('.sky-calendar-preview').count(),
                await card.locator('.sky-calendar-guests').count(),
                await card.getByRole('button', { name: 'Create 12 events & send invites', exact: true }).count(),
                await card.evaluate(
                  (element) =>
                    element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().height < 1400,
                ),
                host.sent.length,
              ],
              expected: [12, 1, 1, 1, true, width === 1440 ? 0 : 12],
            })
            if (artifacts) {
              await mkdir(artifacts, { recursive: true })
              await card.screenshot({ path: path.join(artifacts, `calendar-batch-${width}.png`) })
            }
            await dates.getByRole('button').last().click()
            await card.getByRole('button', { name: 'Edit', exact: true }).click()
            await card.getByLabel('Meeting title', { exact: true }).fill('Atlas final planning')
            await card.getByLabel('Time', { exact: true }).fill('16:00')
            assert({
              given: 'an edit to the selected event',
              should: 'show one editor and prevent losing unsaved changes by switching dates',
              actual: [
                await card.locator('.sky-calendar-edit').count(),
                await dates.getByRole('button').first().isDisabled(),
              ],
              expected: [1, true],
            })
            await card
              .getByRole('button', { name: 'Save changes', exact: true })
              .and(page.locator(':not([disabled])'))
              .click()
            await card.getByRole('heading', { name: 'Atlas final planning', exact: true }).waitFor()
            await page.reload()
            await dates.getByRole('button').last().click()
            await card.getByRole('heading', { name: 'Atlas final planning', exact: true }).waitFor()
            await card.getByRole('button', { name: 'Create 12 events & send invites', exact: true }).click()
            await card.getByText('Event created · Invitations sent', { exact: true }).waitFor()
            await stream
            const sent = host.sent.slice(-12)
            assert({
              given: 'one selected event edited, a reload, and approval of the batch',
              should: 'send all reviewed events once with only the selected event changed',
              actual: [
                sent.length,
                sent.filter((fields) => fields.title === 'Atlas final planning').map((fields) => fields.time),
                sent.filter((fields) => fields.title === 'Atlas planning' && fields.time === '15:00').length,
              ],
              expected: [12, ['16:00'], 11],
            })
          } finally {
            await page.request.post(`${origin}/chat/${id}/stop`, { data: {} })
            await stream
          }
        }
        assert({
          given: 'compact batch reviews on desktop and phone',
          should: 'produce no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)

test(
  { name: 'calendar preparations stay compact and truthful during progress and page reload', timeout: 60000 },
  async (t) => {
    const runs: ToolRun[] = Array.from({ length: 12 }, (_, index) => ({
      tool: 'calendar_schedule',
      callId: `prepare-${index}`,
      at: 1,
      started: 1000,
      finished: 2000,
      status: 'success',
      lines: [],
      input: { request: `Atlas planning, occurrence ${index + 1}` },
      output:
        index === 0
          ? { success: true, status: 'unsupported', unsupported: ['Recurring series are unsupported.'] }
          : { success: true, status: 'ready', draftId: `draft-${index}` },
    }))
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock scheduling notebook\n',
        tempPrefix: 'sky-calendar-progress-',
        day: true,
      },
      async ({ page, origin, errors }) => {
        await page.route('**/chat/calendar-progress', (route) =>
          route.fulfill({
            json: {
              id: 'calendar-progress',
              title: 'Atlas planning',
              turns: [{ role: 'user', content: 'Schedule Atlas planning.' }],
              documents: 0,
              kept: 0,
              busy: true,
              pending: [],
              answered: [],
              runs,
            },
          }),
        )
        await page.goto(`${origin}/thread/calendar-progress`)
        const activity = page.getByRole('button', { name: 'Calendar activity', exact: true })
        await activity.waitFor()
        assert({
          given: 'a burst of scheduling preparations during an unfinished reply',
          should: 'show one compact row with the unsupported result visible and no claim of completed scheduling',
          actual: [await activity.count(), await page.locator('.sky-tool-run').count(), await activity.innerText()],
          expected: [1, 0, '▸\nCalendar activity\nUnsupported request · Draft prepared × 11'],
        })
        const artifacts = env.get('SKY_CALENDAR_SCREENSHOTS')
        if (artifacts) {
          await mkdir(artifacts, { recursive: true })
          await page
            .locator('.sky-calendar-activity')
            .screenshot({ path: path.join(artifacts, 'calendar-activity.png') })
        }
        await activity.click()
        const first = page.getByRole('button', { name: 'Calendar Schedule details', exact: true }).first()
        await first.click()
        const fields = page.locator('.sky-tool-details .sky-tool-fields').first()
        const selected = await fields.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
        runs.push({
          tool: 'calendar_schedule',
          callId: 'blocked',
          at: 1,
          started: 3000,
          finished: 4000,
          lines: [],
          status: 'error',
          input: { request: 'Reworded one-time event.' },
          output: { success: false, retryable: false, status: 'fail', error: 'Wait for the user to choose.' },
        })
        await page.getByText('Stopped for your input', { exact: true }).waitFor()
        assert({
          given: 'another call arriving while the activity inspector is open',
          should: 'keep the inspector and selection intact without labeling drafts Completed',
          actual: [
            await first.getAttribute('aria-expanded'),
            await page.evaluate(() => window.getSelection()?.toString()),
            await page.locator('.sky-tool-runs').getByText('Completed', { exact: true }).count(),
          ],
          expected: ['true', selected, 0],
        })
        await page.reload()
        await activity.waitFor()
        await page.setViewportSize({ width: 390, height: 844 })
        assert({
          given: 'a refreshed chat on a phone with the same recorded preparations',
          should: 'keep the activity compact and fit the screen without browser errors',
          actual: [
            await activity.count(),
            await page.locator('.sky-tool-run').count(),
            await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
            errors,
          ],
          expected: [1, 0, false, []],
        })
      },
    )
  },
)

test(
  { name: 'chat meeting drafts edit, review and send exact invitations on desktop and phone', timeout: 60000 },
  async (t) => {
    let host: ReturnType<typeof calendarApprovalTestHost>
    const artifacts = env.get('SKY_CALENDAR_SCREENSHOTS')
    if (artifacts) await mkdir(artifacts, { recursive: true })
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock calendar notebook\n',
        tempPrefix: 'sky-chat-calendar-ui-',
        day: true,
        chat: (root) => {
          host = calendarApprovalTestHost(root)
          return host.chat
        },
      },
      async ({ page, origin, errors }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.route('**/meetings/_api/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/setup')) return route.fulfill({ json: await host.scheduler.setup() })
          if (pathname.endsWith('/preview'))
            return route.fulfill({ json: await host.scheduler.preview(route.request().postDataJSON()) })
          if (pathname.endsWith('/people')) return route.fulfill({ json: [] })
          if (pathname.includes('/jobs/')) {
            const job = await host.scheduler.get(pathname.split('/').at(-1)!)
            return route.fulfill({ status: job ? 200 : 404, json: job ?? { message: 'No job yet.' } })
          }
          return route.fulfill({ status: 400, json: { message: 'Unexpected calendar write from the browser.' } })
        })
        for (const width of [1440, 390]) {
          const id = `meeting-${width}`
          const started = await fetch(`${origin}/chat/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Schedule Atlas planning with Jane.',
              profile: 'test',
              contextTokens: 0,
              saves: false,
            }),
          })
          const turn = started.text()
          if (!started.ok) throw new Error(await turn)
          try {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 })
            await page.goto(`${origin}/thread/${id}`)
            const card = page.getByRole('region', { name: 'Meeting draft', exact: true })
            await card.getByRole('heading', { name: 'Atlas planning', exact: true }).waitFor()
            await card.locator('.sky-calendar-agenda').evaluate((element) => {
              const range = document.createRange()
              range.selectNodeContents(element)
              window.getSelection()?.removeAllRanges()
              window.getSelection()?.addRange(range)
            })
            await page.waitForResponse((response) => new URL(response.url()).pathname === `/chat/${id}`)
            assert({
              given: 'a selected agenda spanning paragraphs during background polling',
              should: 'preserve the selection',
              actual: await page.evaluate(() => window.getSelection()?.toString()),
              expected: CALENDAR_FIELDS.description,
            })
            await page.evaluate(() => window.getSelection()?.removeAllRanges())
            if (artifacts) await card.screenshot({ path: path.join(artifacts, `meeting-${width}.png`) })
            if (artifacts && width === 1440) {
              await page.evaluate(() => localStorage.setItem('mantine-color-scheme-value', 'dark'))
              await page.reload()
              await card.getByRole('heading', { name: 'Atlas planning', exact: true }).waitFor()
              await card.screenshot({ path: path.join(artifacts, 'meeting-dark.png') })
              await page.evaluate(() => localStorage.setItem('mantine-color-scheme-value', 'light'))
              await page.reload()
              await card.getByRole('heading', { name: 'Atlas planning', exact: true }).waitFor()
            }
            assert({
              given: `a prepared invitation at ${width}px`,
              should: 'show the meeting widget with no overflow or early send',
              actual: [
                await card.locator('.sky-calendar-guests').innerText(),
                await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
                host.sent.length,
              ],
              expected: ['J\nJane Doe\njane@example.com', true, width === 1440 ? 0 : 1],
            })
            await card.getByRole('button', { name: 'Edit', exact: true }).click()
            const title = card.getByLabel('Meeting title', { exact: true })
            await title.fill('Atlas revised planning')
            await card.getByLabel('Time', { exact: true }).fill('16:00')
            await card.getByLabel('Minutes', { exact: true }).fill('45')
            await card.getByLabel('Add invitees', { exact: true }).fill('sam@example.com')
            await card.getByRole('button', { name: 'Add', exact: true }).click()
            await page.waitForResponse((response) => new URL(response.url()).pathname === `/chat/${id}`)
            assert({
              given: 'a chat poll while the owner edits the meeting',
              should: 'preserve the edited title and time',
              actual: [await title.inputValue(), await card.getByLabel('Time', { exact: true }).inputValue()],
              expected: ['Atlas revised planning', '16:00'],
            })
            const save = card.getByRole('button', { name: 'Save changes', exact: true })
            await save.and(page.locator(':not([disabled])')).waitFor()
            if (artifacts) await card.screenshot({ path: path.join(artifacts, `meeting-edit-${width}.png`) })
            await save.click()
            await card.getByRole('heading', { name: 'Atlas revised planning', exact: true }).waitFor()
            await page.reload()
            await card.getByRole('heading', { name: 'Atlas revised planning', exact: true }).waitFor()
            await card.getByRole('button', { name: 'Create & send invites', exact: true }).click()
            await card.getByText('Event created · Invitations sent', { exact: true }).waitFor()
            await turn
            await page.reload()
            await card.getByRole('link', { name: 'Open Calendar', exact: true }).waitFor()
            const expected: CalendarFields = {
              ...CALENDAR_FIELDS,
              title: 'Atlas revised planning',
              time: '16:00',
              duration: 45,
              guests: [...CALENDAR_FIELDS.guests, { name: 'sam@example.com', email: 'sam@example.com' }],
            }
            assert({
              given: 'edits saved, the page reloaded, and one final send',
              should: 'create the reviewed event once and retain Calendar and Zoom links after reload',
              actual: [
                host.sent.at(-1),
                await card.getByRole('link', { name: 'Open Calendar', exact: true }).getAttribute('href'),
                await card.getByRole('link', { name: 'Open Zoom', exact: true }).getAttribute('href'),
                await card.getByRole('button', { name: 'Create & send invites', exact: true }).count(),
                await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
              ],
              expected: [expected, 'https://example.com/calendar/atlas', 'https://example.com/zoom/atlas', 0, true],
            })
            if (artifacts) await card.screenshot({ path: path.join(artifacts, `meeting-created-${width}.png`) })
          } finally {
            await page.request.post(`${origin}/chat/${id}/stop`, { data: {} })
            await turn
          }
        }
        const expired = await fetch(`${origin}/chat/expired/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Schedule Atlas.', profile: 'test', contextTokens: 0, saves: false }),
        })
        const expiredTurn = expired.text()
        try {
          await page.goto(`${origin}/thread/expired`)
          const card = page.getByRole('region', { name: 'Meeting draft', exact: true })
          await card.getByRole('heading', { name: 'Atlas planning', exact: true }).waitFor()
          host.setNow('2031-05-01T12:00:00Z')
          await card.getByRole('button', { name: 'Create & send invites', exact: true }).click()
          await expiredTurn
          await card.getByText('Check Calendar before trying again', { exact: true }).waitFor()
          assert({
            given: 'an approved request that finishes without a saved receipt',
            should: 'offer Calendar without claiming creation or retrying the invitation',
            actual: [host.sent.length, await card.getByRole('link', { name: 'Open Calendar', exact: true }).count()],
            expected: [2, 1],
          })
        } finally {
          await page.request.post(`${origin}/chat/expired/stop`, { data: {} })
          await expiredTurn
        }
        assert({
          given: 'desktop and phone scheduling flows',
          should: 'send one invitation each without browser errors',
          actual: [host.sent.length, errors],
          expected: [2, []],
        })
      },
    )
  },
)

test(
  { name: 'a recurring meeting has one editable draft and one series approval across reloads', timeout: 60000 },
  async (t) => {
    let host: ReturnType<typeof calendarApprovalTestHost>
    const artifacts = env.get('SKY_CALENDAR_SCREENSHOTS')
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock calendar notebook\n',
        tempPrefix: 'sky-calendar-series-ui-',
        day: true,
        chat: (root) => {
          host = calendarApprovalTestHost(root)
          return host.chat
        },
      },
      async ({ page, origin, errors }) => {
        await page.route('**/meetings/_api/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/setup')) return route.fulfill({ json: await host.scheduler.setup() })
          if (pathname.endsWith('/preview'))
            return route.fulfill({ json: await host.scheduler.preview(route.request().postDataJSON()) })
          if (pathname.includes('/jobs/')) {
            const job = await host.scheduler.get(pathname.split('/').at(-1)!)
            return route.fulfill({ status: job ? 200 : 404, json: job ?? {} })
          }
          return route.fulfill({ json: [] })
        })
        for (const width of [1440, 390]) {
          const prepared = await host.scheduler.review({
            fields: { ...CALENDAR_FIELDS, recurrence: { frequency: 'weekly', interval: 1, ends: { type: 'never' } } },
          })
          host.setDraftIds([prepared.draftId!])
          const id = `recurring-${width}`
          const response = await fetch(`${origin}/chat/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Schedule weekly Atlas planning with Jane.',
              profile: 'test',
              contextTokens: 0,
              saves: false,
            }),
          })
          const stream = response.text()
          if (!response.ok) throw new Error(await stream)
          try {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 })
            await page.goto(`${origin}/thread/${id}`)
            const card = page.getByRole('region', { name: 'Meeting draft', exact: true })
            await card.getByText('Weekly on Friday · No end date', { exact: true }).waitFor()
            assert({
              given: `a weekly series on ${width}px`,
              should: 'show one card and first-occurrence availability without an invented end or duplicate date list',
              actual: [
                await card.locator('.sky-calendar-preview').count(),
                await card.getByText('The first occurrence is clear', { exact: true }).count(),
                await card.getByRole('group', { name: 'Events in this request' }).count(),
                host.sent.length,
              ],
              expected: [1, 1, 0, width === 1440 ? 0 : 1],
            })
            if (artifacts) {
              await mkdir(artifacts, { recursive: true })
              await card.screenshot({ path: path.join(artifacts, `series-${width}.png`) })
            }
            await card.getByRole('button', { name: 'Edit', exact: true }).click()
            await card.getByLabel('Repeat every', { exact: true }).fill('2')
            await card.getByRole('combobox', { name: 'Ends', exact: true }).click()
            await card.getByRole('option', { name: 'After', exact: true }).click()
            await card.getByLabel('Occurrences', { exact: true }).fill('13')
            await card
              .getByRole('button', { name: 'Save changes', exact: true })
              .and(page.locator(':not([disabled])'))
              .click()
            await card.getByText('Every 2 weeks on Friday · 13 occurrences', { exact: true }).waitFor()
            await page.reload()
            await card.getByText('Every 2 weeks on Friday · 13 occurrences', { exact: true }).waitFor()
            await card.getByRole('button', { name: 'Create series & send invites', exact: true }).click()
            await card.getByText('Series created · Invitations sent', { exact: true }).waitFor()
            await stream
            await page.reload()
            await card.getByRole('link', { name: 'Open Calendar', exact: true }).waitFor()
            assert({
              given: 'an edited recurrence, a reload, and one approval',
              should: 'create one series with exactly the reviewed cadence and count, and never resend on reload',
              actual: [
                host.sent.length,
                host.sent.at(-1)?.recurrence,
                await card.getByRole('button', { name: 'Create series & send invites', exact: true }).count(),
                await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
              ],
              expected: [
                width === 1440 ? 1 : 2,
                { frequency: 'weekly', interval: 2, ends: { type: 'after', count: 13 } },
                0,
                true,
              ],
            })
          } finally {
            await page.request.post(`${origin}/chat/${id}/stop`, { data: {} })
            await stream
          }
        }
        assert({
          given: 'recurrence review and editing',
          should: 'produce no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
