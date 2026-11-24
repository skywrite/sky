import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { dayActionDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createNeedsResponseHost } from './store.ts'

test('NeedsResponseHost screens with Jev, ranks by age + person score, dismisses/undismisses, resurfaces on new reply, and expires at 7d', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-nr-store-'))
  try {
    const today = new PlainDate('2025-03-15')
    const twoDaysAgo = today.addDays(-2)
    let now = Instant.from('2025-03-15T16:00:00Z')

    const writeMsg = async (day: PlainDate, file: string, content: string) => {
      const full = path.join(root, 'time', dayActionDir('message', day), file)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content)
      return full
    }

    // Close contact waiting 2 days (should rank #1)
    await writeMsg(
      twoDaysAgo,
      '10-00_Slack_Jane.md',
      `---
medium: Slack
from: Jane Doe
link: https://example.slack.com/archives/D1/p1741860000000100
tz: UTC
---

## 2025-03-13 10:00 - Jane Doe

Can you sign off on the budget?
`,
    )

    // Lower-score contact waiting 2h (should rank #2)
    const alexFile = await writeMsg(
      today,
      '14-00_Slack_Alex.md',
      `---
medium: Slack
from: Alex Rivera
link: https://example.slack.com/archives/D2/p1742047200000100
tz: UTC
---

## 2025-03-15 14:00 - Alex Rivera

Quick question about Monday's agenda?
`,
    )

    // FYI message that Jev rejects
    await writeMsg(
      today,
      '13-00_Slack_Maya.md',
      `---
medium: Slack
from: Maya Lin
link: https://example.slack.com/archives/D3/p1742043600000100
tz: UTC
---

## 2025-03-15 13:00 - Maya Lin

Sounds good, thanks!
`,
    )

    // Beeper iMessage resolved from Mac Contacts (no people/ profile, 0 score -> elevated by Mac Contacts!)
    await writeMsg(
      today,
      '14-30_iMessage_Casey.md',
      `---
medium: iMessage
from: Casey Arden
to: Sam Owner
previous: 01/actions/messages/10-00_iMessage_Casey.md
chat: "!imsg-casey"
account: imessage
tz: UTC
---

## 2025-03-15 14:30 - **Casey Arden**

Are you open to a quick call this week?
`,
    )

    // Unregistered stranger (raw phone number, score 0, no profile, owner didn't participate -> never sent to Jev)
    await writeMsg(
      today,
      '12-00_iMessage_Stranger.md',
      `---
medium: iMessage
from: +1-555-888-7777
chat: "!stranger-1"
account: imessage
tz: UTC
---

## 2025-03-15 12:00 — **+1-555-888-7777**

Hello are you looking to sell your property?
`,
    )

    const screenedSenders: string[] = []
    const scores = new Map<string, number>([
      ['jane doe', 500],
      ['alex rivera', 40],
      ['maya lin', 200],
    ])

    const host = createNeedsResponseHost({
      stateDir: path.join(root, 'state', 'needs-response'),
      markdownBaseDir: root,
      timeDir: path.join(root, 'time'),
      getOwnerNames: async () => ['Sam Owner', 'Sam'],
      getSenderLookup: () => ({
        scoreLookup: (name) => scores.get(name.toLowerCase()) ?? 0,
        macContacts: {
          resolve: () => null,
          hasContactName: (name) => name.toLowerCase() === 'casey arden',
        },
      }),
      getTimezone: () => 'UTC',
      now: () => now,
      today: () => today,
      createScreen: async () => ({
        version: 'test-screen-v1',
        assess: async ({ candidate }) => {
          screenedSenders.push(candidate.senderName)
          if (candidate.senderName === 'Maya Lin') {
            return { needsResponse: 0.05, ownerAddressed: 0.9 }
          }
          return { needsResponse: 0.9, ownerAddressed: 0.95 }
        },
      }),
    })

    const report1 = await host.scan()
    const list1 = await host.list()

    assert({
      given: 'five captured conversations (two scored, one Mac Contact iMessage, one FYI, one raw-number stranger)',
      should:
        'skip the raw-number stranger, filter out the FYI, elevate the Mac Contact above the lower-scored colleague, and keep Jane #1',
      actual: {
        screenedCount: report1.screened,
        screenedSenders: screenedSenders.sort(),
        listed: list1.items.map((item) => ({ sender: item.sender, inMacContacts: Boolean(item.inMacContacts) })),
      },
      expected: {
        screenedCount: 4,
        screenedSenders: ['Alex Rivera', 'Casey Arden', 'Jane Doe', 'Maya Lin'],
        listed: [
          { sender: 'Jane Doe', inMacContacts: false },
          { sender: 'Casey Arden', inMacContacts: true },
          { sender: 'Alex Rivera', inMacContacts: false },
        ],
      },
    })

    // Dismiss Alex -> disappears; undismiss -> returns; dismiss again -> disappears.
    const alex = list1.items.find((item) => item.sender === 'Alex Rivera')!
    const afterDismiss = await host.dismiss(alex.id, alex.version)
    const afterUndo = await host.undismiss(alex.id)
    await host.dismiss(alex.id, alex.version)

    assert({
      given: 'dismissing and undoing an item',
      should: 'hide it immediately on dismiss and restore it on undismiss',
      actual: [afterDismiss.items.map((i) => i.sender), afterUndo.items.map((i) => i.sender)],
      expected: [
        ['Jane Doe', 'Casey Arden'],
        ['Jane Doe', 'Casey Arden', 'Alex Rivera'],
      ],
    })

    // Alex sends a NEW follow-up message -> version changes -> resurfaces automatically!
    await writeFile(
      alexFile,
      `---
medium: Slack
from: Alex Rivera
link: https://example.slack.com/archives/D2/p1742047200000100
tz: UTC
---

## 2025-03-15 14:00 - Alex Rivera

Quick question about Monday's agenda?

## 2025-03-15 15:30 - Alex Rivera

Bumping this — need an answer before 5pm!
`,
    )
    const report2 = await host.scan()
    const list2 = await host.list()

    assert({
      given: 'a previously dismissed sender follows up with a new message',
      should: 're-screen only the changed thread and resurface it automatically',
      actual: [report2.screened, list2.items.map((i) => i.sender)],
      expected: [1, ['Jane Doe', 'Casey Arden', 'Alex Rivera']],
    })

    // Advance clock past 7 days for Jane (received 2025-03-13 10:00 -> expires 2025-03-20 10:00).
    now = Instant.from('2025-03-20T12:00:00Z')
    const afterExpiry = await host.list()

    assert({
      given: 'clock moves past 7 days from Jane’s message while Casey and Alex are still within 7 days',
      should: 'expire Jane automatically while keeping Casey and Alex visible',
      actual: afterExpiry.items.map((i) => i.sender),
      expected: ['Casey Arden', 'Alex Rivera'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
