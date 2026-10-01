import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const TITLE = 'Atlas planning'
const THREAD = '/thread/atlas-live'

test(
  { name: 'live chat links support native new tabs and in-app navigation in both day lists', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '## Professional Todos\n\n- Review the checklist\n',
        file: path.posix.join('time', dayFile(DAY)),
        tempPrefix: 'day-chat-links-',
        day: true,
        now: new ZonedDateTime('2026-01-27T12:00:00', 'UTC'),
      },
      async ({ page, origin, errors }) => {
        const context = page.context()
        context.on('page', (tab) => tab.on('pageerror', (error) => errors.push(error.message)))
        await context.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        await context.route('**/chat', (route) =>
          route.fulfill({
            json: {
              threads: [
                {
                  id: 'atlas-live',
                  title: TITLE,
                  day: DAY.ymd,
                  when: '10:00',
                  state: 'done',
                  turns: 2,
                  busy: false,
                  saves: false,
                  saved: null,
                  parent: null,
                  inherited: 0,
                },
              ],
            },
          }),
        )
        await context.route('**/chat/atlas-live', (route) =>
          route.fulfill({
            json: {
              title: TITLE,
              day: DAY.ymd,
              turns: [
                { role: 'user', content: 'Review the checklist.' },
                { role: 'assistant', content: 'Confirm the next action.' },
              ],
              documents: 0,
              kept: 0,
              busy: false,
              inherited: 0,
              parent: null,
            },
          }),
        )
        await context.route('**/chat/atlas-live/settings', (route) =>
          route.fulfill({
            json: {
              model: {
                current: 'test',
                default: 'test',
                choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: [] }],
              },
              contextTokens: 0,
              saves: false,
            },
          }),
        )
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForFunction(() => document.title.includes('January 27'))
        const dayTitle = await page.title()
        for (const list of ['.sky-day-chat', '.sky-rail [data-section="chats"]']) {
          const link = page.locator(list).getByRole('link', { name: TITLE, exact: true })
          await link.waitFor()
          const contextMenu = page.evaluate(
            () =>
              new Promise<{ prevented: boolean; href: string | null }>((resolve) => {
                document.addEventListener(
                  'contextmenu',
                  (event) =>
                    resolve({
                      prevented: event.defaultPrevented,
                      href: (event.target as Element).closest('a')?.getAttribute('href') ?? null,
                    }),
                  { once: true },
                )
              }),
          )
          await link.click({ button: 'right' })
          assert({
            given: `right-clicking a live chat in ${list}`,
            should: 'offer the native link context menu without navigating away',
            actual: { ...(await contextMenu), page: page.url() },
            expected: { prevented: false, href: THREAD, page: `${origin}/${DAY.ymd}` },
          })
          await page.keyboard.press('Escape')
          for (const gesture of ['modified click', 'middle click']) {
            const opened = context.waitForEvent('page')
            await link.click(gesture === 'modified click' ? { modifiers: ['ControlOrMeta'] } : { button: 'middle' })
            const tab = await opened
            try {
              await tab.waitForURL(`${origin}${THREAD}`)
              await tab.waitForFunction((title) => document.title === `sky:chat - ${title}`, TITLE)
              await tab.getByText('Confirm the next action.', { exact: true }).waitFor()
              assert({
                given: `${gesture} on a live chat in ${list}`,
                should: 'open the conversation in another tab and preserve the original day',
                actual: { original: page.url(), originalTitle: await page.title(), tabs: context.pages().length },
                expected: { original: `${origin}/${DAY.ymd}`, originalTitle: dayTitle, tabs: 2 },
              })
            } finally {
              await tab.close()
            }
          }
          const documentBefore = await page.evaluateHandle(() => document)
          await link.click()
          await page.waitForURL(`${origin}${THREAD}`)
          await page.waitForFunction((title) => document.title === `sky:chat - ${title}`, TITLE)
          assert({
            given: `an ordinary click on a live chat in ${list}`,
            should: 'navigate within the app without reloading the document',
            actual: await page.evaluate((before) => document === before, documentBefore),
            expected: true,
          })
          await documentBefore.dispose()
          await page.goBack()
          await link.waitFor()
          await page.waitForFunction((title) => document.title === title, dayTitle)
        }
        assert({
          given: 'chat links opened from both day lists',
          should: 'raise no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
