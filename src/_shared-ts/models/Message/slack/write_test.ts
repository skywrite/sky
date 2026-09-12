import { assert, test } from '#test'
import { parseSlackConversation } from './parse.ts'
import { sectionSlackConversation, slackMessageId, updateSlackConversation, type SlackWriteMessage } from './write.ts'

const message = (ts: string, text: string, timestamp = '2026-04-10 09:00'): SlackWriteMessage => ({
  id: slackMessageId('C0ATLAS', ts),
  timestamp,
  author: 'Jane Doe',
  text,
})

test('Slack writer keeps attachments with attachment-only messages, before the inventory', () => {
  const first = {
    ...message('1770000000.000001', ''),
    attachments: [{ id: 'attachment-slack-F0ATLAS', name: 'photo [1].png', file: '2026-04-10_Slack_photo [1].png' }],
  }
  const initial = updateSlackConversation('# Atlas\n\n', [first])
  const reply = message('1770000000.000002', 'Received.')
  const updated = updateSlackConversation(initial + '\n## Notes\n\nKeep this note.\n', [first, reply])
  const parsed = parseSlackConversation(updated)
  assert({
    given: 'a photo with no typed text and a same-minute reply',
    should: 'keep both messages and link the photo',
    actual: [
      parsed.messages.length,
      parsed.messages[0].attachmentIds,
      parsed.messages[0].body.includes('(empty)'),
      parsed.attachments.length,
    ],
    expected: [2, ['attachment-slack-F0ATLAS'], false, 1],
  })
  assert({
    given: 'a reply received after an attachment section and manual notes exist',
    should: 'insert it inside Conversation and keep notes',
    actual: updated.indexOf('Received.') < updated.indexOf('## Attachments') && updated.endsWith('Keep this note.\n'),
    expected: true,
  })
  assert({
    given: 'the same export twice',
    should: 'leave the saved bytes unchanged',
    actual: updateSlackConversation(updated, [first, reply]),
    expected: updated,
  })
})

test('Slack writer upgrades legacy messages without losing manual Markdown or nested headings', () => {
  const old =
    '# Atlas\n\nIntro.\n\n## 2026-04-10 09:00 - **Jane Doe**\n\nHello.\n\n### Detail\n\nKeep details.\n\n## Notes\n\nKeep this note.\n'
  const source = message('1770000000.000001', 'Hello.')
  const reply = message('1770000001.000001', 'Next.', '2026-04-10 09:01')
  const updated = updateSlackConversation(old, [source, reply])
  const parsed = parseSlackConversation(updated)
  assert({
    given: 'a legacy message with a manual subsection and notes',
    should: 'retain text, promote hierarchy and add source IDs',
    actual: [
      parsed.format,
      parsed.messages.map((item) => item.id),
      updated.includes('#### Detail\n\nKeep details.'),
      updated.endsWith('Keep this note.\n'),
    ],
    expected: ['sectioned', [source.id, reply.id], true, true],
  })
})

test('Slack writer preserves inline transcripts and attachment summaries on a later export', () => {
  const source = {
    ...message('1770000000.000001', 'Listen.'),
    attachments: [{ id: 'attachment-slack-F0MEMO', name: 'memo.m4a', file: 'memo.m4a' }],
  }
  let initial = updateSlackConversation('# Atlas\n\n', [source])
  initial =
    initial.replace('## Attachments', '*(voice memo transcript)*\n\nKeep the spoken words.\n\n## Attachments') +
    '\nOptional summary.\n'
  assert({
    given: 'a saved transcript and manually added attachment summary',
    should: 'preserve them exactly on repeated capture',
    actual: updateSlackConversation(initial, [{ ...source, text: 'Edited at source.' }]),
    expected: initial,
  })
})

test('Slack writer contains source headings and rejects unsafe message boundaries', () => {
  const source = message(
    '1770000000.000001',
    '# Heading\n\n## Conversation\n\n### Subheading\n\n> ## Quoted\n\n\u0060\u0060\u0060\n## Example\n\u0060\u0060\u0060',
  )
  const result = updateSlackConversation('# Atlas\n', [source, message('1770000001.000001', 'Next.')])
  assert({
    given: 'headings and code in Slack content',
    should: 'keep them inside one message',
    actual: parseSlackConversation(result).messages.length,
    expected: 2,
  })
  let error = ''
  try {
    updateSlackConversation('# Atlas\n', [
      message('1770000000.000001', '\u0060\u0060\u0060\nUnclosed'),
      message('1770000001.000001', 'Next.'),
    ])
  } catch (caught) {
    error = String(caught)
  }
  assert({
    given: 'an unclosed fence swallowing a following message',
    should: 'refuse the unsafe write',
    actual: error.includes('boundaries'),
    expected: true,
  })
})

test('Slack legacy conversion respects fenced examples and separated manual sections', () => {
  const old =
    '# Atlas\r\n\r\n## 2026-04-10 09:00 - **Jane Doe**\r\n\r\nOne.\r\n\r\n## Notes\r\n\r\nNote.\r\n\r\n## 2026-04-10 09:01 - **John Smith**\r\n\r\nTwo.\r\n'
  const converted = sectionSlackConversation(old)
  assert({
    given: 'CRLF legacy messages separated by notes',
    should: 'preserve their order and content while changing only the heading structure',
    actual: [
      parseSlackConversation(converted).messages.length,
      converted.includes('One.\r\n\r\n## Notes\r\n\r\nNote.'),
      sectionSlackConversation(converted),
    ],
    expected: [2, true, converted],
  })
})

test('Slack writer refuses to guess legacy identities from author and minute alone', () => {
  const old = '# Atlas\n\n## 2026-04-10 09:00 - **Jane Doe**\n\nHand-edited content.\n'
  let failed = false
  try {
    updateSlackConversation(old, [message('1770000000.000001', 'Different source text.')])
  } catch {
    failed = true
  }
  assert({
    given: 'an unmatched legacy message sharing an author and minute',
    should: 'stop before risking a duplicate or wrong attachment association',
    actual: failed,
    expected: true,
  })
})
