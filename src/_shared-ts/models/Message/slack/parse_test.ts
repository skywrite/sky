import { assert, test } from '#test'
import { isConversationSection, parseSlackConversation } from './parse.ts'

test('Slack captures expose old and new message headings with the same author and time', () => {
  const message = '2025-03-15 9:30 - **Jane Doe**\n\nHello.\n'
  const old = parseSlackConversation(`# Topic\n\n## ${message}`)
  const next = parseSlackConversation(`# Topic\n\n## Conversation\n\n### ${message}`)
  assert({
    given: 'the same message saved in either layout',
    should: 'identify it independently of its heading level',
    actual: [old, next].map((doc) => [doc.format, doc.messages.map((m) => [m.timestamp, m.author, m.body.trim()])]),
    expected: [
      ['legacy', [['2025-03-15 9:30', 'Jane Doe', 'Hello.']]],
      ['sectioned', [['2025-03-15 9:30', 'Jane Doe', 'Hello.']]],
    ],
  })
})

test('Slack message recognition respects Markdown block structure and Conversation boundaries', () => {
  const doc = parseSlackConversation(
    [
      '# Topic',
      '## Conversation',
      '### 2025-03-15 09:00 - **Jane Doe**',
      '',
      'A real message.',
      '',
      '> ### 2025-03-15 09:01 - **John Smith**',
      '',
      '- A quoted example:',
      '  ### 2025-03-15 09:02 - **John Smith**',
      '',
      '    ### 2025-03-15 09:03 - **John Smith**',
      '',
      '````markdown',
      '### 2025-03-15 09:04 - **John Smith**',
      '```',
      '### 2025-03-15 09:05 - **John Smith**',
      '````',
      '',
      '~~~',
      '### 2025-03-15 09:06 - **John Smith**',
      '~~~',
      '',
      '<!--',
      '### 2025-03-15 09:07 - **John Smith**',
      '-->',
      '',
      '<pre>',
      '### 2025-03-15 09:08 - **John Smith**',
      '</pre>',
      '',
      '#### 2025-03-15 09:09 - **John Smith**',
      '',
      '## Attachments',
      '### 2025-03-15 09:10 - **John Smith**',
      '',
      'A filename that resembles a message heading.',
      '',
      '## Notes',
      '### 2025-03-15 09:11 - **John Smith**',
      '',
      'An unrelated section.',
    ].join('\n'),
  )
  assert({
    given: 'message-shaped headings in code, quotes, lists, HTML, attachments, and notes',
    should: 'recognize only the real message and keep nested content in its body',
    actual: [doc.messages.map((m) => m.author), doc.attachments.length, doc.messages[0].body.includes('<pre>')],
    expected: [['Jane Doe'], 1, true],
  })
})

test('Slack attachment-only and voice messages retain file references in their own message bodies', () => {
  const doc = parseSlackConversation(`
# Topic

## Conversation

<a id="message-first"></a>

### 2025-03-15 09:00 - **Jane Doe**

[voice-note.m4a](#attachment-a1)

*(voice memo transcript)*

Please review the drawing.

<a id="message-second"></a>

### 2025-03-15 09:01 - John Smith

[drawing.pdf][drawing]
[Photo](#attachment-unavailable)
[Notes](#notes)

\u0060[Fake link](#attachment-fake)\u0060

## Attachments (2)

<a id="attachment-a1"></a>

### voice-note.m4a

[Original](voice-note.m4a)

<a id='attachment-a2'></a>

### drawing.pdf

[Original](drawing.pdf)

[drawing]: #attachment-a2
`)
  assert({
    given: 'two messages referencing preserved files, including a pending attachment',
    should: 'keep IDs, filenames, inline transcript, and unresolved attachment references',
    actual: {
      messages: doc.messages.map((m) => [m.id, m.author, m.attachmentIds]),
      attachments: doc.attachments.map((a) => [a.id, a.name]),
      transcript: doc.messages[0].body.includes('*(voice memo transcript)*\n\nPlease review the drawing.'),
      anchorOwnership: doc.messages[0].markdown.includes('message-second'),
    },
    expected: {
      messages: [
        ['message-first', 'Jane Doe', ['attachment-a1']],
        ['message-second', 'John Smith', ['attachment-a2', 'attachment-unavailable']],
      ],
      attachments: [
        ['attachment-a1', 'voice-note.m4a'],
        ['attachment-a2', 'drawing.pdf'],
      ],
      transcript: true,
      anchorOwnership: false,
    },
  })
})

test('Slack source ranges preserve CRLF, Unicode, reference definitions, and neighboring sections', () => {
  const message = '<a id="message-first"></a>\r\n\r\n### 2025-03-15 25:30 - **Jane Doe**\r\n\r\n[file][file]\r\n\r\n'
  const source =
    '# Topic 📝\r\n\r\n[file]: #attachment-file\r\n\r\n## Conversation\r\n\r\n' +
    message +
    '## Attachments\r\n\r\n<a id="attachment-file"></a>\r\n\r\n### drawing.pdf\r\n\r\nKeep this entry.'
  const parsed = parseSlackConversation(source)
  const target = parsed.messages[0]
  const replacement = '### 2025-03-15 25:30 - **Jane Doe**\r\n\r\nUpdated words.\r\n\r\n'
  assert({
    given: 'a CRLF document with an emoji and link definitions before the message',
    should: 'supply exact ranges for replacing that message without changing anything else',
    actual: [
      target.markdown,
      source.slice(0, target.start) + replacement + source.slice(target.end),
      parsed.attachments[0].markdown.endsWith('Keep this entry.'),
      target.attachmentIds,
    ],
    expected: [message, source.replace(message, replacement), true, ['attachment-file']],
  })
})

test('Slack readers tolerate mixed layouts and preserve unrecognized prose', () => {
  const source =
    '# Topic\n\nMy notes.\n\n## 2025-03-15 09:00 - **Jane Doe**\n\nEarlier.\n\n' +
    '## Conversation\n\n### 2025-03-15 09:01 - **John Smith**\n\nLater.\n\n## Notes\n\nKeep this.'
  const parsed = parseSlackConversation(source)
  assert({
    given: 'old and new messages in one document',
    should: 'read both while preserving the complete original document',
    actual: [parsed.format, parsed.messages.map((m) => m.author), parsed.markdown],
    expected: ['mixed', ['Jane Doe', 'John Smith'], source],
  })
})

test('Empty Slack sections and headings at EOF expose usable boundaries', () => {
  const parsed = parseSlackConversation('# Topic\n\n## Conversation\n\n## Attachments')
  const section = parsed.sections.find(isConversationSection)!
  const last = parseSlackConversation('## Conversation\n\n### 2025-03-15 09:00 - **Jane Doe**')
  assert({
    given: 'an empty conversation and a message without any body or final newline',
    should: 'locate the insertion boundary and recognize the empty message',
    actual: [parsed.messages.length, parsed.markdown.slice(section.end), last.messages[0].body],
    expected: [0, '## Attachments', ''],
  })
})
