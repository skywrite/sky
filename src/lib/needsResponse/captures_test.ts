import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { dayActionDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { mentionsOwner, scanCapturedConversations } from './captures.ts'

async function writeCapture(root: string, day: PlainDate, name: string, content: string): Promise<string> {
  const rel = path.join('time', dayActionDir('message', day), name)
  const full = path.join(root, rel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, content)
  return rel
}

test('scanCapturedConversations detects Slack DMs, group DMs, @mentions, owner-started threads, and Beeper chats', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-nr-captures-'))
  try {
    const today = new PlainDate('2025-03-15')
    const yesterday = today.addDays(-1)
    const now = Instant.from('2025-03-15T16:00:00Z')
    const slackDmsDir = path.join(root, 'state', 'slack', 'dms')
    await mkdir(slackDmsDir, { recursive: true })

    // 1. Slack DM record (1:1) unanswered
    const dmPath = await writeCapture(
      root,
      yesterday,
      '14-00_Slack_Jane.md',
      `---
medium: Slack
from: Jane Doe
to: Sam Owner
link: https://example.slack.com/archives/D111/p1741960800000100
tz: UTC
---

## 2025-03-14 14:00 - Jane Doe

Can you approve the Atlas scope before noon tomorrow?
`,
    )
    await writeFile(
      path.join(slackDmsDir, 'D111.yaml'),
      `id: D111\nkind: dm\nlabel: Jane Doe\nlastActivity: "2025-03-14 14:00"\ndocs:\n  - date: "2025-03-14"\n    path: ${dmPath}\n`,
    )

    // 2. Slack group DM (MPDM) unanswered
    const groupPath = await writeCapture(
      root,
      today,
      '10-00_Slack_Group.md',
      `---
medium: Slack
from: Alex Rivera
to: Alex Rivera, Maya Lin
link: https://example.slack.com/archives/G222/p1742032800000100
tz: UTC
---

## 2025-03-15 10:00 - Alex Rivera

Sam, should we ship v2 on Friday or wait for QA?
`,
    )
    await writeFile(
      path.join(slackDmsDir, 'G222.yaml'),
      `id: G222\nkind: group\nlabel: Alex Rivera, Maya Lin\nlastActivity: "2025-03-15 10:00"\ndocs:\n  - date: "2025-03-15"\n    path: ${groupPath}\n`,
    )

    // 3. Slack @mention in a channel
    await writeCapture(
      root,
      today,
      '11-00_Slack_Mention.md',
      `---
medium: Slack
channel: "#atlas"
from: Maya Lin
link: https://example.slack.com/archives/C333/p1742036400000100
tz: UTC
---

## 2025-03-15 11:00 - Maya Lin

@Sam can you confirm the launch partner quote?
`,
    )

    // 4. Slack thread started by owner with a new reply needing input
    await writeCapture(
      root,
      today,
      '12-00_Slack_Thread.md',
      `---
medium: Slack
channel: "#eng"
from: Sam Owner
link: https://example.slack.com/archives/C444/p1742037000000100
tz: UTC
---

## 2025-03-15 11:30 - Sam Owner

Let's finalize the rollout plan today.

## 2025-03-15 12:15 - Chen Wei

Do you want EU enabled in wave 1 or wave 2?
`,
    )

    // 5. Beeper iMessage unanswered
    await writeCapture(
      root,
      today,
      '13-00_iMessage_Pat.md',
      `---
medium: iMessage
from: Pat Kim
to: Sam Owner
chat: "!beeper-chat-1"
account: imessage
tz: UTC
---

## 2025-03-15 13:00 — **Pat Kim**

Are we still on for dinner at 7?
`,
    )

    const candidates = await scanCapturedConversations({
      markdownBaseDir: root,
      timeDir: path.join(root, 'time'),
      slackDmsDir,
      today,
      now,
      timezone: 'UTC',
      ownerNames: ['Sam Owner', 'Sam'],
    })

    const summary = candidates
      .map((c) => ({
        source: c.source,
        kind: c.kind,
        sender: c.senderName,
        ownerParticipated: c.ownerParticipated,
        contextLabel: c.contextLabel,
        hasTarget: Boolean(c.target),
      }))
      .sort((a, b) => a.sender.localeCompare(b.sender))

    assert({
      given: 'unanswered Slack DM, group DM, channel mention, owner-started thread, and Beeper iMessage',
      should: 'detect all five with accurate kinds, context labels, and native targets',
      actual: summary,
      expected: [
        {
          source: 'Slack',
          kind: 'group',
          sender: 'Alex Rivera',
          ownerParticipated: false,
          contextLabel: 'Alex Rivera, Maya Lin',
          hasTarget: true,
        },
        {
          source: 'Slack',
          kind: 'thread',
          sender: 'Chen Wei',
          ownerParticipated: true,
          contextLabel: '#eng',
          hasTarget: true,
        },
        {
          source: 'Slack',
          kind: 'dm',
          sender: 'Jane Doe',
          ownerParticipated: false,
          contextLabel: undefined,
          hasTarget: true,
        },
        {
          source: 'Slack',
          kind: 'mention',
          sender: 'Maya Lin',
          ownerParticipated: false,
          contextLabel: '#atlas',
          hasTarget: true,
        },
        {
          source: 'iMessage',
          kind: 'dm',
          sender: 'Pat Kim',
          ownerParticipated: false,
          contextLabel: undefined,
          hasTarget: true,
        },
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scanCapturedConversations auto-clears when the owner replies on a later day across Slack and Beeper', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-nr-autoclear-'))
  try {
    const today = new PlainDate('2025-03-15')
    const yesterday = today.addDays(-1)
    const now = Instant.from('2025-03-15T16:00:00Z')
    const slackDmsDir = path.join(root, 'state', 'slack', 'dms')
    await mkdir(slackDmsDir, { recursive: true })

    // Slack DM received yesterday, replied to today in a separate day file.
    const dmDay1 = await writeCapture(
      root,
      yesterday,
      '18-00_Slack_Jane.md',
      `---
medium: Slack
from: Jane Doe
to: Sam Owner
link: https://example.slack.com/archives/D555/p1741975200000100
tz: UTC
---

## 2025-03-14 18:00 - Jane Doe

Did you get a chance to review the memo?
`,
    )
    const dmDay2 = await writeCapture(
      root,
      today,
      '09-00_Slack_Jane.md',
      `---
medium: Slack
from: Sam Owner
to: Jane Doe
link: https://example.slack.com/archives/D555/p1742029200000200
tz: UTC
---

## 2025-03-15 09:00 - Sam Owner

Yes, left comments!
`,
    )
    await writeFile(
      path.join(slackDmsDir, 'D555.yaml'),
      `id: D555\nkind: dm\nlabel: Jane Doe\nlastActivity: "2025-03-15 09:00"\ndocs:\n  - date: "2025-03-14"\n    path: ${dmDay1}\n  - date: "2025-03-15"\n    path: ${dmDay2}\n`,
    )

    // Beeper chat received yesterday, replied to today.
    await writeCapture(
      root,
      yesterday,
      '20-00_WhatsApp_Alex.md',
      `---
medium: WhatsApp
from: Alex Rivera
to: Sam Owner
chat: "!wa-chat-9"
account: whatsapp
tz: UTC
---

## 2025-03-14 20:00 — **Alex Rivera**

Can you send the address?
`,
    )
    await writeCapture(
      root,
      today,
      '08-30_WhatsApp_Alex.md',
      `---
medium: WhatsApp
from: Sam Owner
to: Alex Rivera
chat: "!wa-chat-9"
account: whatsapp
tz: UTC
---

## 2025-03-15 08:30 — **Sam Owner**

Sent it over!
`,
    )

    const candidates = await scanCapturedConversations({
      markdownBaseDir: root,
      timeDir: path.join(root, 'time'),
      slackDmsDir,
      today,
      now,
      timezone: 'UTC',
      ownerNames: ['Sam Owner', 'Sam'],
    })

    assert({
      given: 'Slack DM and Beeper chat answered by the owner on the next day',
      should: 'join both days and auto-clear both conversations',
      actual: candidates,
      expected: [],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scanCapturedConversations excludes followed Slack channel threads where the owner neither posted nor was @mentioned', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-nr-fyi-'))
  try {
    const today = new PlainDate('2025-03-15')
    const tenDaysAgo = today.addDays(-10)
    const now = Instant.from('2025-03-15T16:00:00Z')

    // 1. Followed channel thread purely between teammates -> MUST be excluded!
    await writeCapture(
      root,
      today,
      '12-00_Slack_FYI.md',
      `---
medium: Slack
channel: "#launch-sync"
from: Alex Rivera
follow: 2025-03-10_slack_launch-sync_pr-review
link: https://example.slack.com/archives/C777/p1741600000000100
tz: UTC
---

## 2025-03-15 12:00 - **Alex Rivera**

@Jane Doe FYI here is the latest draft.

## 2025-03-15 14:00 - **Jane Doe**

@Alex Rivera - yes, we still need clarity on item 2.
`,
    )

    // 2. Channel thread where @Samantha is tagged (substring of Sam) -> MUST NOT match @Sam!
    await writeCapture(
      root,
      today,
      '13-00_Slack_Substring.md',
      `---
medium: Slack
channel: "#ops"
from: Maya Lin
link: https://example.slack.com/archives/C778/p1742040000000100
tz: UTC
---

## 2025-03-15 13:00 - **Maya Lin**

@Samantha can you check the invoice?
`,
    )

    // 3. Channel thread started by the owner 10 days ago (via Sky's `DD/actions/messages/...` shorthand) with a new reply today -> INCLUDED as thread!
    await writeCapture(
      root,
      tenDaysAgo,
      '09-00_Slack_OwnerStart.md',
      `---
medium: Slack
channel: "#eng"
from: Sam Owner
link: https://example.slack.com/archives/C779/p1741165200000100
tz: UTC
---

## 2025-03-05 09:00 - **Sam Owner**

Let's review the migration plan once benchmarks finish.
`,
    )
    await writeCapture(
      root,
      today,
      '15-00_Slack_Reply.md',
      `---
medium: Slack
channel: "#eng"
from: Chen Wei
previous: 05/actions/messages/09-00_Slack_OwnerStart
link: https://example.slack.com/archives/C779/p1741165200000100
tz: UTC
---

## 2025-03-15 15:00 - **Chen Wei**

Benchmarks are done — ready for your call on phase 2?
`,
    )

    const candidates = await scanCapturedConversations({
      markdownBaseDir: root,
      timeDir: path.join(root, 'time'),
      today,
      now,
      timezone: 'UTC',
      ownerNames: ['Sam Owner', 'Sam'],
    })

    assert({
      given: 'mentionsOwner boundary checks',
      should: 'match exact @mentions and reject substring names or email addresses',
      actual: [
        mentionsOwner('Hi @Sam, thoughts?', ['Sam Owner', 'Sam']),
        mentionsOwner('@Sam Owner - please review', ['Sam Owner', 'Sam']),
        mentionsOwner('@Samantha can you check?', ['Sam Owner', 'Sam']),
        mentionsOwner('email test@sam.com for info', ['Sam Owner', 'Sam']),
      ],
      expected: [true, true, false, false],
    })

    assert({
      given:
        'an FYI followed channel thread, a substring @Samantha thread, and a 10-day-old owner-started thread with a new reply',
      should: 'exclude both uninvolved threads and admit only the owner-started thread with kind=thread',
      actual: candidates.map((c) => ({
        sender: c.senderName,
        kind: c.kind,
        ownerParticipated: c.ownerParticipated,
      })),
      expected: [{ sender: 'Chen Wei', kind: 'thread', ownerParticipated: true }],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
