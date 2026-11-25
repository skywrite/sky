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

test('NeedsResponseHost scores replies: a tick or a reply earns the message, a follow-up keeps the clock, the X earns nothing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-nr-score-'))
  try {
    const today = new PlainDate('2025-03-15')
    let now = Instant.from('2025-03-15T09:30:00Z')
    let day = today

    const slackDm = (channel: string, turns: Array<[time: string, who: string, text: string]>) =>
      `---\nmedium: Slack\nfrom: ${turns[0][1]}\nlink: https://example.slack.com/archives/${channel}/p1742029200000100\ntz: UTC\n---\n\n` +
      turns.map(([time, who, text]) => `## 2025-03-15 ${time} - ${who}\n\n${text}\n`).join('\n')
    const write = async (file: string, content: string) => {
      const full = path.join(root, 'time', dayActionDir('message', today), file)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content)
    }

    await write('09-00_Slack_Jane.md', slackDm('D1', [['09:00', 'Jane Doe', 'Can you sign off on the budget?']]))
    await write('09-10_Slack_Alex.md', slackDm('D2', [['09:10', 'Alex Rivera', 'Which day works for the review?']]))
    await write('09-25_Slack_Pat.md', slackDm('D4', [['09:25', 'Pat Kim', 'Did you see the Atlas notes?']]))
    await write('09-26_Slack_Lee.md', slackDm('D6', [['09:26', 'Lee Wong', 'Can we move Thursday?']]))
    const casey = (turns: string) =>
      `---\nmedium: iMessage\nfrom: Casey Arden\nto: Sam Owner\nchat: "!imsg-casey"\naccount: imessage\ntz: UTC\n---\n\n${turns}`
    await write('09-20_iMessage_Casey.md', casey('## 2025-03-15 09:20 - **Casey Arden**\n\nAre you free for a call?\n'))

    const scores = new Map<string, number>([
      ['jane doe', 500],
      ['alex rivera', 40],
      ['pat kim', 30],
      ['lee wong', 20],
    ])
    const host = createNeedsResponseHost({
      stateDir: path.join(root, 'state', 'needs-response'),
      markdownBaseDir: root,
      timeDir: path.join(root, 'time'),
      getOwnerNames: async () => ['Sam Owner', 'Sam'],
      getSenderLookup: () => ({ scoreLookup: (name) => scores.get(name.toLowerCase()) ?? 0 }),
      getTimezone: () => 'UTC',
      now: () => now,
      today: () => day,
      createScreen: async () => ({
        version: 'test-screen-v1',
        assess: async () => ({ needsResponse: 0.9, ownerAddressed: 0.95 }),
      }),
    })
    const bySender = (items: Awaited<ReturnType<typeof host.list>>['items'], sender: string) =>
      items.find((item) => item.sender === sender)!

    await host.scan()
    const first = await host.list()

    assert({
      given: 'five fresh messages, none answered',
      should: 'be worth 100 each, with under an hour waited and nothing earned yet',
      actual: {
        points: first.items.map((item) => item.points),
        fresh: first.items.every((item) => item.ageHours < 1),
        todayPoints: first.todayPoints,
      },
      expected: { points: [100, 100, 100, 100, 100], fresh: true, todayPoints: 0 },
    })

    // Alex follows up in the afternoon: the message changes, the wait does not start over.
    await write(
      '09-10_Slack_Alex.md',
      slackDm('D2', [
        ['09:10', 'Alex Rivera', 'Which day works for the review?'],
        ['14:45', 'Alex Rivera', 'Any update on this?'],
      ]),
    )
    now = Instant.from('2025-03-15T15:00:00Z')
    await host.scan()
    const afterFollowUp = await host.list()
    const alex = bySender(afterFollowUp.items, 'Alex Rivera')

    assert({
      given: 'a follow-up from the sender five and a half hours in',
      should: 'keep the clock running from the first message, now past the 1-hour and 4-hour marks',
      actual: {
        receivedAt: alex.receivedAt,
        ageHours: alex.ageHours,
        points: alex.points,
        dropsInMinutes: alex.dropsInMinutes,
      },
      expected: {
        receivedAt: '2025-03-15T14:45:00Z',
        ageHours: 5.8,
        points: 60,
        dropsInMinutes: 370,
      },
    })

    // The tick earns what the message is worth now; Undo takes it back; the X earns nothing.
    const jane = bySender(afterFollowUp.items, 'Jane Doe')
    const ticked = await host.dismiss(jane.id, jane.version, 'responded')
    const undone = await host.undismiss(jane.id)
    const tickedAgain = await host.dismiss(jane.id, jane.version, 'responded')
    const pat = bySender(afterFollowUp.items, 'Pat Kim')
    const crossed = await host.dismiss(pat.id, pat.version)

    assert({
      given: 'a tick six hours in, an Undo, the tick again, then another message cleared with the X',
      should: 'earn 60 for the tick, return to 0 on Undo, earn 60 again, and add nothing for the X',
      actual: [ticked.todayPoints, undone.todayPoints, tickedAgain.todayPoints, crossed.todayPoints],
      expected: [60, 0, 60, 60],
    })

    // Sky finds two replies in the conversations themselves: one to a listed message, one that never reached the list.
    await write(
      '09-20_iMessage_Casey.md',
      casey(
        '## 2025-03-15 09:20 - **Casey Arden**\n\nAre you free for a call?\n\n## 2025-03-15 10:00 - **Sam Owner**\n\nYes, calling at 11.\n',
      ),
    )
    await write(
      '15-00_Slack_Maya.md',
      slackDm('D5', [
        ['15:00', 'Maya Lin', 'Lunch tomorrow?'],
        ['15:05', 'Sam Owner', 'Yes!'],
        ['15:06', 'Maya Lin', 'Noon?'],
        ['15:07', 'Sam Owner', 'Perfect.'],
      ]),
    )
    now = Instant.from('2025-03-15T15:10:00Z')
    await host.scan()
    const afterReplies = await host.list()

    assert({
      given: 'a reply sent 40 minutes after a listed message, and a quick back-and-forth Sky never listed',
      should: 'take the answered message off the list and earn 100 for each conversation, once',
      actual: {
        waiting: afterReplies.items.map((item) => item.sender).sort(),
        todayPoints: afterReplies.todayPoints,
        weekPoints: afterReplies.weekPoints,
      },
      expected: { waiting: ['Alex Rivera', 'Lee Wong'], todayPoints: 260, weekPoints: 260 },
    })

    // Alex gets an answer late in the evening: more than 12 hours after the first message.
    await write(
      '09-10_Slack_Alex.md',
      slackDm('D2', [
        ['09:10', 'Alex Rivera', 'Which day works for the review?'],
        ['14:45', 'Alex Rivera', 'Any update on this?'],
        ['21:30', 'Sam Owner', 'Tuesday works.'],
      ]),
    )
    now = Instant.from('2025-03-15T21:40:00Z')
    await host.scan()
    const score = await host.score()

    assert({
      given: 'a reply 12 hours and 20 minutes after the first message',
      should: 'earn 40 from the first message, and add the day up with no cap',
      actual: { today: score.today, week: score.week, waits: score.waits, days: score.days.length },
      expected: {
        today: { points: 300, replies: 4, quick: 2 },
        week: { points: 300, replies: 4 },
        waits: [2, 0, 1, 1, 0, 0],
        days: 30,
      },
    })

    // A week on, Lee never got a reply. Pat was cleared with the X, so Pat is not counted as ignored.
    now = Instant.from('2025-03-22T10:00:00Z')
    day = new PlainDate('2025-03-22')
    await host.scan()
    const weekLater = await host.score()
    const listWeekLater = await host.list()

    assert({
      given: 'seven days with no reply to one message, and another that was cleared with the X',
      should: 'record only the unanswered one as no reply, worth nothing, with the old points out of the last 7 days',
      actual: {
        waits: weekLater.waits,
        today: weekLater.today.points,
        list: [listWeekLater.todayPoints, listWeekLater.weekPoints],
      },
      expected: { waits: [0, 0, 0, 0, 0, 1], today: 0, list: [0, 0] },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('NeedsResponseHost counts a reply for the notebook day that is still open past midnight', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-nr-openday-'))
  try {
    const openDay = new PlainDate('2025-03-15')
    // Half past midnight on the calendar, and the notebook is still on the 15th.
    const now = Instant.from('2025-03-16T00:30:00Z')
    const full = path.join(root, 'time', dayActionDir('message', openDay), '23-50_Slack_Jane.md')
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(
      full,
      `---\nmedium: Slack\nfrom: Jane Doe\nlink: https://example.slack.com/archives/D1/p1742029200000100\ntz: UTC\n---\n\n## 2025-03-15 23:50 - Jane Doe\n\nStill up? Can you confirm the Atlas date?\n`,
    )

    const host = createNeedsResponseHost({
      stateDir: path.join(root, 'state', 'needs-response'),
      markdownBaseDir: root,
      timeDir: path.join(root, 'time'),
      getOwnerNames: async () => ['Sam Owner', 'Sam'],
      getSenderLookup: () => ({ scoreLookup: () => 100 }),
      getTimezone: () => 'UTC',
      getDayOf: () => () => openDay.ymd,
      now: () => now,
      today: () => openDay,
      createScreen: async () => ({
        version: 'test-screen-v1',
        assess: async () => ({ needsResponse: 0.9, ownerAddressed: 0.95 }),
      }),
    })

    await host.scan()
    const [jane] = (await host.list()).items
    const ticked = await host.dismiss(jane.id, jane.version, 'responded')
    const score = await host.score()

    assert({
      given: 'a tick at half past midnight while the notebook day is still the day before',
      should: 'count the points for the open day, which is the last of the 30 days shown',
      actual: {
        todayPoints: ticked.todayPoints,
        today: score.today,
        lastDay: score.days.at(-1),
      },
      expected: {
        todayPoints: 100,
        today: { points: 100, replies: 1, quick: 1 },
        lastDay: { date: '2025-03-15', points: 100, replies: 1 },
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
