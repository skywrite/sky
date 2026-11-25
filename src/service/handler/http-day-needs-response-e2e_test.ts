import type { NeedsResponseHost, NeedsResponseItem, NeedsResponseList } from '#lib/needsResponse/mod.ts'
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
  // A tick earns the message's points; the X earns nothing.
  const ticked = new Set<string>()
  const opened: string[] = []
  const visible = () => initial.filter((item) => !dismissed.has(item.id))
  const earned = () => initial.filter((item) => ticked.has(item.id)).reduce((sum, item) => sum + item.points, 0)
  const list = (): NeedsResponseList => ({
    items: visible(),
    lastScanAt: '2031-03-17T15:00:00Z',
    todayPoints: earned(),
    weekPoints: earned(),
  })

  const host: NeedsResponseHost = {
    list: async () => list(),
    scan: async () => ({
      scannedAt: '2031-03-17T15:00:00Z',
      capturesFound: initial.length,
      gmailThreadsChecked: 0,
      screened: 0,
      active: visible().length,
      errors: [],
    }),
    dismiss: async (id, _version, how) => {
      dismissed.add(id)
      if (how === 'responded') ticked.add(id)
      return list()
    },
    undismiss: async (id) => {
      dismissed.delete(id)
      ticked.delete(id)
      return list()
    },
    score: async () => ({
      today: { points: earned(), replies: ticked.size, quick: 0 },
      week: { points: 460 + earned(), replies: 5 + ticked.size },
      // Thirty days, today last: a quiet day each week, and today is whatever the ticks earned.
      days: Array.from({ length: 30 }, (_, index) => ({
        date: TODAY.addDays(index - 29).ymd,
        points: index === 29 ? earned() : index % 7 === 0 ? 0 : 60 + index * 20,
        replies: index === 29 ? ticked.size : index % 7 === 0 ? 0 : 1 + (index % 4),
      })),
      waits: [3, 1, 1, 0, 0, 1],
    }),
    openInApp: async (id) => {
      opened.push(id)
    },
    refreshIfStale: () => {},
  }
  return { host, opened }
}

test(
  {
    name: 'Needs response sits above To-dos on Today, scores each message, supports checkbox clear with Undo, and stays hidden on past days',
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
        points: 40,
        dropsInMinutes: 1260,
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
        points: 100,
        dropsInMinutes: 120,
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

        // Each row shows what a reply earns as dots, and the head links to today's score.
        const dots = await card
          .locator('.sky-score-dots')
          .evaluateAll((els) => els.map((el) => [el.getAttribute('data-level'), el.getAttribute('aria-label')]))
        const scoreLink = card.locator('a.sky-score-link')
        const scoreAtStart = await scoreLink.getAttribute('aria-label')

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

        // Clearing both with the X earns nothing, so the card hides completely.
        await janeRow.hover()
        await janeRow.getByRole('button', { name: 'Dismiss Jane Doe', exact: true }).click()
        await page.getByText('Dismissed — Jane Doe').waitFor()
        const alexRow = card.locator('.sky-nr-row', { hasText: 'Alex Rivera' })
        await alexRow.hover()
        await alexRow.getByRole('button', { name: 'Dismiss Alex Rivera', exact: true }).click()
        await card.waitFor({ state: 'detached' })

        // A tick earns the message's points, and the card then stays for the day even with nothing waiting.
        await host.undismiss(items[0].id)
        await host.undismiss(items[1].id)
        await page.reload()
        await card.waitFor()
        await card.getByRole('button', { name: 'Mark Jane Doe responded', exact: true }).click()
        await page.getByText('Responded — Jane Doe').waitFor()
        await card.locator('a.sky-score-link', { hasText: '40' }).waitFor()
        await alexRow.hover()
        await alexRow.getByRole('button', { name: 'Dismiss Alex Rivera', exact: true }).click()
        await card.getByText('Nothing is waiting on you.').waitFor()
        const scoreAfterTick = await scoreLink.getAttribute('aria-label')

        // The link opens the score page: today's points, how long people waited, 30 days, and the grading steps.
        await scoreLink.click()
        const scorePage = page.locator('.sky-rs')
        await scorePage.locator('.sky-rs-hero-number').waitFor()
        const score = {
          path: new URL(page.url()).pathname,
          title: await page.title(),
          today: await scorePage.locator('.sky-rs-hero-number').textContent(),
          sections: await scorePage.locator('.sky-rs-section-head h2').allTextContents(),
          waited: await scorePage.locator('.sky-rs-split-part').allTextContents(),
          columns: await scorePage.locator('.sky-rs-daily-bar').count(),
          steps: await scorePage.locator('.sky-rs-value').allTextContents(),
        }
        await scorePage.getByRole('link', { name: 'Today', exact: true }).click()
        await page.locator('.sky-needs-response').waitFor()
        const backOnToday = { path: new URL(page.url()).pathname, title: await page.title() }

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

        assert({
          given: 'a message worth 40 and one worth 100, then a tick on the first',
          should: 'show two and five dots, start the day at 0, and earn 40 for the tick',
          actual: { dots, scoreAtStart, scoreAfterTick },
          expected: {
            dots: [
              ['2', 'Worth 40 points'],
              ['5', 'Worth 100 points'],
            ],
            scoreAtStart: 'Response score: 0 points today',
            scoreAfterTick: 'Response score: 40 points today',
          },
        })

        assert({
          given: 'the score link followed from Today, then the link back',
          should: 'open the score page under its own title with every section, and return to Today',
          actual: { score, backOnToday },
          expected: {
            score: {
              path: '/responses',
              title: 'sky · Response score',
              today: '40',
              sections: ['How long people waited', 'Last 30 days', 'How a message is graded', 'What counts'],
              waited: ['3', '1', '1', '1'],
              columns: 25,
              steps: ['100', '80', '60', '40', '20', '0'],
            },
            backOnToday: { path: '/', title: 'sky · Monday, March 17, 2031 · Day record' },
          },
        })
      },
    )
  },
)
