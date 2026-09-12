import { assert, test } from '#test'
import { mergeSlackConversations } from './merge.ts'
import { parseSlackConversation } from './parse.ts'

test('Merging old and new Slack captures preserves attachments, references, and notes', () => {
  const old = parseSlackConversation(
    '# Old\n\nKeep my introduction.\n\n## 2025-03-15 09:00 - **Jane Doe**\n\nEarlier.\n\n## Personal notes\n\nKeep my notes.\n',
  )
  const next = parseSlackConversation(`# New

## Conversation

<a id="message-second"></a>

### 2025-03-15 09:01 - **John Smith**

[drawing.pdf](#attachment-a1)

## Attachments

<a id="attachment-a1"></a>

### drawing.pdf

[Original](drawing.pdf)

#### Notes

An existing attachment annotation.
`)
  const merged = mergeSlackConversations([next, old], 'Combined')
  const parsed = parseSlackConversation(merged)
  assert({
    given: 'different layouts and a PDF entry with an annotation',
    should: 'merge messages in order and retain the file association and manual content',
    actual: [
      parsed.format,
      parsed.messages.map((m) => [m.level, m.author, m.attachmentIds]),
      parsed.attachments.map((a) => a.id),
      ['Keep my introduction.', 'Keep my notes.', 'An existing attachment annotation.'].every((text) =>
        merged.includes(text),
      ),
      mergeSlackConversations([parsed], 'Combined') === merged,
    ],
    expected: [
      'sectioned',
      [
        [3, 'Jane Doe', []],
        [3, 'John Smith', ['attachment-a1']],
      ],
      ['attachment-a1'],
      true,
      true,
    ],
  })
})

test('Merging Slack messages distinguishes same-minute replies and preserves provider identities', () => {
  const first = parseSlackConversation(
    '# Topic\n\n## 2025-03-15 09:00 - **Jane Doe**\n\nFirst.\n\n## 2025-03-15 09:00 - **Jane Doe**\n\nSecond.\n',
  )
  const next = parseSlackConversation(
    '# Topic\n\n## Conversation\n\n<a id="message-a"></a>\n\n### 2025-03-15 09:00 - **Jane Doe**\n\nFirst.\n\n<a id="message-b"></a>\n\n### 2025-03-15 09:00 - **Jane Doe**\n\nFirst.\n',
  )
  const merged = parseSlackConversation(mergeSlackConversations([first, next], 'Topic'))
  assert({
    given: 'two different legacy replies in one minute and two distinct source IDs with the same text',
    should: 'deduplicate the legacy copy and retain the distinct messages and known IDs',
    actual: merged.messages.map((m) => [m.id, m.body.trim()]),
    expected: [
      ['message-a', 'First.'],
      [undefined, 'Second.'],
      ['message-b', 'First.'],
    ],
  })
})

test('An all-legacy Slack merge keeps H2 messages and does not convert captures', () => {
  const source = '# Topic\n\n## 2025-03-15 09:00 - **Jane Doe**\n\nHello.\n'
  const parsed = parseSlackConversation(mergeSlackConversations([parseSlackConversation(source)], 'Topic'))
  assert({
    given: 'only legacy input',
    should: 'keep the existing format',
    actual: [parsed.format, parsed.messages[0].level],
    expected: ['legacy', 2],
  })
})

test('A mixed Slack merge moves nested headings with their original message', () => {
  const old = parseSlackConversation(
    '# Old\n\n  ## 2025-03-15 09:00 - **Jane Doe**\n\nHello.\n\n### Details\n\nKeep these with the message.\n\n#### 2025-03-15 09:02 - **John Smith**\n\nAn example heading.\n',
  )
  const next = parseSlackConversation('# New\n\n## Conversation\n\n### 2025-03-15 09:01 - **John Smith**\n\nNext.\n')
  const merged = mergeSlackConversations([old, next], 'Topic')
  const parsed = parseSlackConversation(merged)
  assert({
    given: 'a legacy message with content headings being merged into the new layout',
    should: 'retain its full body and keep nested author-shaped headings out of the message list',
    actual: [
      parsed.messages.length,
      parsed.messages[0].body.includes('#### Details'),
      parsed.messages[0].body.includes('An example heading.'),
      mergeSlackConversations([parsed, old], 'Topic') === merged,
    ],
    expected: [2, true, true, true],
  })
})

test('A Slack merge rejects an unclosed fence that would swallow another message', () => {
  const old = parseSlackConversation('# Old\n\n## 2025-03-15 09:00 - **Jane Doe**\n\n```\nUnclosed example.\n')
  const next = parseSlackConversation('# Next\n\n## 2025-03-15 09:01 - **John Smith**\n\nNext.\n')
  let error = ''
  try {
    mergeSlackConversations([old, next], 'Topic')
  } catch (caught) {
    error = (caught as Error).message
  }
  assert({
    given: 'a capture ending inside a code fence',
    should: 'fail before a later message becomes code content',
    actual: error,
    expected: 'Merged Slack Markdown would change message boundaries or attachment references.',
  })
})

test('Conflicting Slack source IDs stop a merge before it can discard edits', () => {
  const base = '# Topic\n\n## Conversation\n\n<a id="message-a"></a>\n\n### 2025-03-15 09:00 - **Jane Doe**\n\n'
  let error = ''
  try {
    mergeSlackConversations(
      [parseSlackConversation(base + 'First version.'), parseSlackConversation(base + 'Edited version.')],
      'Topic',
    )
  } catch (caught) {
    error = (caught as Error).message
  }
  assert({
    given: 'two different saved bodies for the same source message',
    should: 'report the conflict instead of selecting one silently',
    actual: error,
    expected: 'Conflicting saved Slack message: message-a',
  })
})
