import type { NeedsResponseHost, NeedsResponseItem } from '#lib/needsResponse/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const TODAY = new PlainDate('2031-03-17')
const YESTERDAY = TODAY.addDays(-1)

function makeMockNeedsResponseHost(initial: NeedsResponseItem[]): {
  host: NeedsResponseHost
  opened: string[]
} {
  const dismissed = new Set<string>()
  const opened: string[] = []
  const visible = () => initial.filter((item) => !dismissed.has(item.id))

  const host: NeedsResponseHost = {
    list: async () => ({ items: visible(), lastScanAt: '2031-03-17T15:00:00Z' }),
    scan: async () => ({
      scannedAt: '2031-03-17T15:00:00Z',
      capturesFound: initial.length,
      gmailThreadsChecked: 0,
      screened: 0,
      active: visible().length,
      errors: [],
    }),
    dismiss: async (id) => {
      dismissed.add(id)
      return { items: visible(), lastScanAt: '2031-03-17T15:00:00Z' }
    },
    undismiss: async (id) => {
      dismissed.delete(id)
      return { items: visible(), lastScanAt: '2031-03-17T15:00:00Z' }
    },
    openInApp: async (id) => {
      opened.push(id)
    },
    refreshIfStale: () => {},
  }
  return { host, opened }
}

test(
  {
    name: 'Needs response sits above To-dos on Today, supports checkbox clear with Undo, and stays hidden on past days',
    timeout: 60000,
  },
  async (t) => {
    const items: NeedsResponseItem[] = [
      {
        id: 'Slack:dm:https://example.slack.com:D1',
        version: 'v1',
        source: 'Slack',
        kind: 'dm',
        sender: 'Jane Doe',
        summary: 'Can you approve the Atlas scope?',
        receivedAt: '2031-03-15T12:00:00Z',
        receivedLocal: '2031-03-15 12:00',
        ageHours: 51,
        personScore: 420,
        priority: 16.4,
        href: 'https://example.slack.com/archives/D1/p1',
      },
      {
        id: 'Beeper:imessage:!chat-1',
        version: 'v2',
        source: 'iMessage',
        kind: 'dm',
        sender: 'Alex Rivera',
        summary: 'Are we still meeting at 4?',
        receivedAt: '2031-03-17T13:00:00Z',
        receivedLocal: '2031-03-17 13:00',
        ageHours: 2,
        personScore: 180,
        priority: 9.4,
        href: null,
        openInApp: 'beeper',
      },
    ]
    const { host, opened } = makeMockNeedsResponseHost(items)

    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `---\nstarted: 08:00\ntz: UTC\n---\n\n## Most Important\n\n- Decide the Atlas scope\n\n## Professional Todos\n\n- Draft Atlas brief\n\n## Reminders\n\n- Leave room for a walk\n`,
        files: {
          ['time/' + dayFile(YESTERDAY)]:
            `---\nstarted: 08:00\ntz: UTC\n---\n\n## Professional Todos\n\n- Wrap up slides\n`,
        },
        file: 'time/' + dayFile(TODAY),
        tempPrefix: 'day-needs-response-',
        day: true,
        now: new ZonedDateTime({ date: TODAY.ymd, time: '15:00', timezone: 'UTC' }),
        needsResponse: host,
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/?view=record`)
        const card = page.locator('.sky-needs-response')
        await card.waitFor()

        // Verify section ordering: Most important -> Needs response -> To-dos -> Reminders
        const headings = await page
          .locator('.sky-col > .sky-block > .sky-block-head')
          .evaluateAll((els) => els.map((el) => el.childNodes[0]?.textContent?.trim()))
        const nrIdx = headings.indexOf('Needs response')
        const miIdx = headings.indexOf('Most important')
        const todoIdx = headings.indexOf('To-dos')

        assert({
          given: 'Today with pending responses',
          should: 'render Needs response directly below Most important and above To-dos',
          actual: [miIdx >= 0 && nrIdx === miIdx + 1, todoIdx === nrIdx + 1],
          expected: [true, true],
        })

        // Verify service logos are rendered with clear accessible labels on each row.
        const services = await card
          .locator('.sky-nr-icon')
          .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))

        // Clicking Beeper item invokes the native open endpoint.
        await card.locator('button.sky-nr-link', { hasText: 'Alex Rivera' }).click()
        await page.waitForTimeout(150)

        // Checking off Jane Doe removes the row and offers Undo; Undo restores it.
        await card.getByRole('button', { name: 'Mark Jane Doe responded', exact: true }).click()
        await page.getByText('Responded — Jane Doe').waitFor()
        const afterFirstCheck = await card.locator('.sky-nr-sender').allTextContents()

        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await card.locator('.sky-nr-sender', { hasText: 'Jane Doe' }).waitFor()
        const afterUndo = await card.locator('.sky-nr-sender').allTextContents()

        // Pressing the × button (just like Reminders) dismisses Jane Doe with Undo, then Undo restores it.
        const janeRow = card.locator('.sky-nr-row', { hasText: 'Jane Doe' })
        await janeRow.hover()
        await janeRow.getByRole('button', { name: 'Dismiss Jane Doe', exact: true }).click()
        await page.getByText('Dismissed — Jane Doe').waitFor()
        const afterX = await card.locator('.sky-nr-sender').allTextContents()

        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await card.locator('.sky-nr-sender', { hasText: 'Jane Doe' }).waitFor()

        // Clearing both hides the Needs response card completely.
        await card.getByRole('button', { name: 'Mark Jane Doe responded', exact: true }).click()
        await page.getByText('Responded — Jane Doe').waitFor()
        const alexRow = card.locator('.sky-nr-row', { hasText: 'Alex Rivera' })
        await alexRow.hover()
        await alexRow.getByRole('button', { name: 'Dismiss Alex Rivera', exact: true }).click()
        await card.waitFor({ state: 'detached' })

        // Past day never renders Needs response.
        await host.undismiss(items[0].id)
        await page.goto(`${origin}/${YESTERDAY.ymd}?view=record`)
        await page.getByText('Wrap up slides').waitFor()
        const pastCardCount = await page.locator('.sky-needs-response').count()

        assert({
          given: 'service badges, Beeper open, checkbox clear + × dismiss with Undo, and viewing a past day',
          should: 'show service badges, support both checkbox and × with Undo, hide when empty, and omit on past days',
          actual: {
            services,
            opened,
            afterFirstCheck,
            afterUndo,
            afterX,
            pastCardCount,
            errors,
          },
          expected: {
            services: ['Slack', 'iMessage'],
            opened: ['Beeper:imessage:!chat-1'],
            afterFirstCheck: ['Alex Rivera'],
            afterUndo: ['Jane Doe', 'Alex Rivera'],
            afterX: ['Alex Rivera'],
            pastCardCount: 0,
            errors: [],
          },
        })
      },
    )
  },
)
