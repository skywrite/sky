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
