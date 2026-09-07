import type { GmailMessage } from '#lib/google/gmail.ts'
import { assert, test } from '#test'
import { readThreadContent } from './readThreadContent.ts'

function message(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return { id: 'a1', threadId: 'ff', labelIds: [], attachments: [], ...overrides }
}

test('readThreadContent retains recent messages when the thread exceeds the budget', () => {
  const messages = Array.from({ length: 7 }, (_, i) =>
    message({ from: { address: `sender${i}@example.com` }, bodyText: String(i).repeat(4000) }),
  )
  messages.push(message({ from: { address: 'jane@example.com' }, bodyText: 'Use the revised agenda.' }))
  const content = readThreadContent(messages)

  assert({
    given: 'a long conversation followed by a short correction',
    should: 'keep the correction and the most recent context in chronological order, with explicit omissions',
    expected: {
      senders: [...Array.from({ length: 6 }, (_, i) => `sender${i + 1}@example.com`), 'jane@example.com'],
      newest: 'Use the revised agenda.',
      total: 8,
      omitted: 1,
      truncated: true,
      shortened: [true, false, false, false, false, false, false],
      chars: 24_000,
    },
    actual: {
      senders: content.messages.map((row) => row.from),
      newest: content.messages.at(-1)?.text,
      total: content.totalMessages,
      omitted: content.omittedMessages,
      truncated: content.truncated,
      shortened: content.messages.map((row) => row.truncated),
      chars: content.messages.reduce((sum, row) => sum + row.text.length, 0),
    },
  })
})

test('readThreadContent distinguishes a full budget from truncated content', () => {
  const messages = Array.from({ length: 6 }, () => message({ bodyText: 'a'.repeat(4000) }))
  const exact = readThreadContent(messages)
  const overflow = readThreadContent([message({ bodyText: 'Older context' }), ...messages])
  const longBody = readThreadContent([message({ bodyText: 'b'.repeat(4001) })])

  assert({
    given: 'an exact fit, an extra old message, and an oversized individual message',
    should: 'flag only actual omissions or shortened bodies',
    expected: [
      [6, 0, false, false],
      [6, 1, true, false],
      [1, 0, true, true],
    ],
    actual: [exact, overflow, longBody].map((content) => [
      content.messages.length,
      content.omittedMessages,
      content.truncated,
      content.messages.some((row) => row.truncated),
    ]),
  })
  assert({
    given: 'one oversized message',
    should: 'cap its body at 4,000 characters',
    expected: 4000,
    actual: longBody.messages[0].text.length,
  })
})

test('readThreadContent prefers plain text and falls back to readable HTML', () => {
  const content = readThreadContent([
    message({
      from: { name: 'Jane Doe', address: 'jane@example.com' },
      bodyText: ' Plain text ',
      bodyHtml: '<p>HTML</p>',
    }),
    message({
      from: { address: 'bob@example.com' },
      bodyText: ' ',
      bodyHtml: '<style>p {color:red}</style><p>Hello &amp; welcome</p><script>ignore()</script>',
    }),
    message(),
  ])
  assert({
    given: 'plain text, HTML-only, and empty messages',
    should: 'return readable bodies with sender fallbacks and no false truncation',
    expected: [
      ['Jane Doe', 'Plain text', false],
      ['bob@example.com', 'Hello & welcome', false],
      ['(unknown)', '(no readable body)', false],
    ],
    actual: content.messages.map((row) => [row.from, row.text, row.truncated]),
  })
})

test('readThreadContent does not split emoji at either character limit', () => {
  const perMessage = readThreadContent([message({ bodyText: 'a'.repeat(3999) + '😀' })])
  const wholeThread = readThreadContent([
    message({ bodyText: '😀 earlier message' }),
    message({ bodyText: 'a'.repeat(3999) }),
    ...Array.from({ length: 5 }, () => message({ bodyText: 'b'.repeat(4000) })),
  ])
  assert({
    given: 'a cap inside an emoji and only one code unit left for an older emoji',
    should: 'return valid text and report the older message as omitted',
    expected: [3999, true, 6, 1, true],
    actual: [
      perMessage.messages[0].text.length,
      perMessage.truncated,
      wholeThread.messages.length,
      wholeThread.omittedMessages,
      wholeThread.truncated,
    ],
  })
})
