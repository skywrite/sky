import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { SavedMessages } from './sources.ts'

test('Outbox indexes old and new Slack messages while excluding attachment and example timestamps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-slack-sources-'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const ref = '2025-03-15/actions/messages/slack_Atlas.md'
  try {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      `---
from: Jane Doe
to: John Smith
medium: Slack
when: 2025-03-15 08:00
---

# Topic

## 2025-03-15 09:00 - **Jane Doe**

Earlier message.

## Conversation

### 2025-03-15 25:30 - **John Smith**

[drawing.pdf](#attachment-a1)

\u0060\u0060\u0060markdown
## 2025-03-18 10:00 - **Jane Doe**
\u0060\u0060\u0060

## Attachments

<a id="attachment-a1"></a>

### 2025-03-19 10:00 - **Jane Doe**

[Original](drawing.pdf)
`,
    )
    const current = await sources.discover(null, '2025-03-16')
    const falseMatch = await sources.discover(current, '2025-03-18')
    const attachmentMatch = await sources.discover(current, '2025-03-19')
    const stale = structuredClone(current)
    stale.entries![ref].times = ['2025-03-15 08:00']
    delete stale.entries![ref].parserVersion
    const refreshed = await sources.discover(stale, '2025-03-16')
    assert({
      given: 'mixed headings, an extended hour, and unchanged metadata cached by the old reader',
      should:
        'find actual next-day activity and rebuild stale timestamps without treating examples or filenames as messages',
      actual: [
        current.entries![ref].times,
        current.pending,
        falseMatch.pending,
        attachmentMatch.pending,
        refreshed.pending,
      ],
      expected: [['2025-03-15 09:00', '2025-03-16 01:30'], [ref], [], [], [ref]],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Outbox retains long linked histories and detects changes beyond the former reading limits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-history-sources-'))
  const follows = path.join(root, 'follows')
  const sources = new SavedMessages(root, { Slack: [follows], Email: [] })
  const refs = [
    ...Array.from(
      { length: 35 },
      (_, index) => `2025-03-13/actions/messages/slack_Atlas-${String(index).padStart(2, '0')}.md`,
    ),
    '2025-03-15/actions/messages/slack_Atlas.md',
  ]
  const largeBody =
    '## 2025-03-13 08:00 - **Jane Doe**\n' + 'Earlier context. '.repeat(12_000) + '\nEnd of old context.'
  const write = async (ref: string, body: string) => {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      new Document(
        { medium: 'Slack', follow: 'atlas-thread', from: 'Jane Doe', to: 'Alex Example' },
        body,
      ).toMarkdown(),
    )
  }
  try {
    await mkdir(follows)
    await writeFile(
      path.join(follows, 'atlas-thread.yaml'),
      'source: Slack\nref:\n  link: https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100\nmessages:\n' +
        refs.map((ref) => `  - date: ${ref.slice(0, 10)}\n    path: ${ref}\n`).join(''),
    )
    for (const [index, ref] of refs.entries())
      await write(ref, index === 0 ? largeBody : `## ${ref.slice(0, 10)} 09:00 - **Jane Doe**\nContext ${index}.`)
    const inventory = await sources.discover(null, '2025-03-15')
    const conversation = (await sources.conversation(refs.at(-1)!))!
    const fromOldest = (await sources.conversation(refs[0]))!
    await write(refs[0], largeBody + '\nThe earlier scope has changed.')
    const current = await sources.current(conversation)
    assert({
      given: '36 linked captures, one larger than 160 KB, with only today’s activity selected',
      should: 'retain every source, produce a stable version across seeds and notice edits anywhere in the history',
      actual: [
        inventory.pending,
        conversation.sources.length,
        Boolean(conversation.incomplete),
        conversation.limitations,
        conversation.sources[0].body === largeBody,
        fromOldest.version === conversation.version,
        current.version !== conversation.version,
        current.sources[0].body.endsWith('The earlier scope has changed.'),
      ],
      expected: [[refs.at(-1)], refs.length, false, [], true, true, true, true],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Outbox reads a capture whose participants are not plain text as blank participants', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-participants-'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const ref = '2025-03-15/actions/messages/email_Atlas.md'
  try {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      new Document(
        { medium: 'Email', from: ['Jane Doe', 'Maya Okafor'], when: '2025-03-15 09:00' },
        '## 2025-03-15 09:00 - **Jane Doe**\n\nCould you review the update?\n',
      ).toMarkdown(),
    )
    const conversation = (await sources.conversation(ref))!
    assert({
      given: 'a saved email whose from is a list and whose to is missing',
      should: 'record empty participants instead of serialized YAML',
      actual: conversation.sources.map(({ from, to }) => ({ from, to })),
      expected: [{ from: '', to: '' }],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Outbox admits Beeper captures, joins a chat across days, and gives it the desktop app as destination', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-sources-'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const earlier = '2026-03-10/actions/messages/09-12_whatsapp_Maya_Budget.md'
  const later = '2026-03-11/actions/messages/08-05_whatsapp_Maya_Photo.md'
  const group = '2026-03-11/actions/messages/07-55_whatsapp_Atlas-launch-team_Kickoff.md'
  const other = '2026-03-11/actions/messages/10-00_imessage_Sam_Lunch.md'
  const write = async (ref: string, text: string) => {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
  }
  try {
    await write(
      earlier,
      '---\nfrom: Maya Okafor\nto: Jane Doe\nwhen: 2026-03-10 09:12\nmedium: WhatsApp\nsummary: Budget\nchat: c1\naccount: whatsapp\n---\n\n## 2026-03-10 09:12 - **Maya Okafor**\n\nCan you approve the pilot budget by Friday?\n',
    )
    await write(
      later,
      '---\nfrom: Maya Okafor\nto: Jane Doe\nwhen: 2026-03-11 08:05\nmedium: WhatsApp\nsummary: Photo\nchat: c1\naccount: whatsapp\n---\n\n## 2026-03-11 08:05 - **Maya Okafor**\n\nAlso: the photo\n',
    )
    await write(
      group,
      '---\nfrom: Sam Lee\nto: Atlas launch team\nwhen: 2026-03-11 07:55\nmedium: WhatsApp\nsummary: Kickoff\nchat: c2\naccount: whatsapp\ngroup: true\n---\n\n## 2026-03-11 07:55 - **Sam Lee**\n\nKickoff moved to 3pm\n',
    )
    await write(
      other,
      '---\nfrom: Sam Lee\nto: Jane Doe\nwhen: 2026-03-11 10:00\nmedium: iMessage\nsummary: Lunch\n---\n\n## 2026-03-11 10:00 - **Sam Lee**\n\nLunch?\n',
    )
    const inventory = await sources.discover(null, '2026-03-11')
    const single = await sources.conversation(later)
    const groupChat = await sources.conversation(group)
    assert({
      given: 'two days of one WhatsApp chat, a group chat, and a hand-written iMessage capture without chat ids',
      should:
        'review the Beeper files, join the chat by its id, name Beeper as the destination, and leave the hand capture out',
      actual: [
        inventory.pending,
        inventory.entries?.[later]?.beeper,
        inventory.entries?.[other]?.beeper,
        single && [
          single.key,
          single.medium,
          single.target,
          single.sources.map((source) => source.ref),
          single.limitations,
        ],
        groupChat && [groupChat.key, groupChat.target, groupChat.sources.map((source) => source.to)],
      ],
      expected: [
        [group, later],
        true,
        undefined,
        ['Beeper:whatsapp:c1', 'WhatsApp', { medium: 'Beeper', account: 'whatsapp', chat: 'c1' }, [earlier, later], []],
        [
          'Beeper:whatsapp:c2',
          { medium: 'Beeper', account: 'whatsapp', chat: 'c2', group: true },
          ['Atlas launch team'],
        ],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
