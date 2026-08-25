import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import { assert, test } from '#test'
import { buildChatTranscript, CHAT_ENRICH } from './enrich.ts'

const msg = (role: 'user' | 'assistant', content: string): ConversationMessage => ({ role, content })

test('CHAT_ENRICH frames the chat medium', () => {
  assert({ given: 'the chat framing', should: 'use the chat corpus', actual: CHAT_ENRICH.mediums, expected: ['chat'] })
})

test('buildChatTranscript labels turns by role', () => {
  const transcript = buildChatTranscript([msg('user', 'Should we ship Atlas this week?'), msg('assistant', 'Yes.')])
  assert({
    given: 'a two-turn chat',
    should: 'label each turn',
    actual: transcript,
    expected: 'User: Should we ship Atlas this week?\n\nAI: Yes.',
  })
})

test('buildChatTranscript strips hidden comments and skips emptied turns', () => {
  const transcript = buildChatTranscript([
    msg('user', 'Plan the week.'),
    msg('assistant', 'Focus on Atlas.\n\n<!-- marker: weekly planning -->'),
    msg('assistant', '<!-- marker: only plumbing -->'),
  ])
  assert({
    given: 'turns with HTML comments',
    should: 'strip comments and drop comment-only turns',
    actual: transcript,
    expected: 'User: Plan the week.\n\nAI: Focus on Atlas.',
  })
})

test('buildChatTranscript clips assistant turns harder than user turns', () => {
  const transcript = buildChatTranscript([msg('user', 'u'.repeat(3000)), msg('assistant', 'a'.repeat(3000))])
  const [userPart, aiPart] = transcript.split('\n\n')
  assert({
    given: 'an over-long user turn',
    should: 'clip at the user cap with a mark',
    actual: userPart,
    expected: `User: ${'u'.repeat(2000)} […]`,
  })
  assert({
    given: 'an over-long assistant turn',
    should: 'clip at the assistant cap with a mark',
    actual: aiPart,
    expected: `AI: ${'a'.repeat(1200)} […]`,
  })
})

test('buildChatTranscript keeps head and tail of an over-long chat', () => {
  const messages: ConversationMessage[] = []
  for (let i = 0; i < 20; i++) {
    messages.push(msg('user', `Question ${i}: ${'q'.repeat(500)}`))
    messages.push(msg('assistant', `Answer ${i}: ${'a'.repeat(900)}`))
  }
  const transcript = buildChatTranscript(messages)
  assert({
    given: 'a chat past the budget',
    should: 'fit the budget',
    actual: transcript.length <= 8000,
    expected: true,
  })
  assert({
    given: 'a chat past the budget',
    should: 'mark the omitted middle',
    actual: transcript.includes('[... middle omitted ...]'),
    expected: true,
  })
  assert({
    given: 'a chat past the budget',
    should: 'keep the opening turn',
    actual: transcript.startsWith('User: Question 0:'),
    expected: true,
  })
  assert({
    given: 'a chat past the budget',
    should: 'keep the final turn',
    actual: transcript.includes('Answer 19:'),
    expected: true,
  })
})

test('buildChatTranscript never strands a surrogate at the tail cut', () => {
  // An emoji flood makes some tail cut land inside a surrogate pair unless guarded.
  const messages: ConversationMessage[] = []
  for (let i = 0; i < 12; i++) {
    messages.push(msg('user', '😀'.repeat(500)))
    messages.push(msg('assistant', '😀'.repeat(500)))
  }
  const transcript = buildChatTranscript(messages)
  const afterOmission = transcript.split('[... middle omitted ...]')[1] ?? ''
  const first = afterOmission.trimStart().charCodeAt(0)
  assert({
    given: 'a tail cut landing in emoji',
    should: 'not lead the tail with a low surrogate',
    actual: first >= 0xdc00 && first <= 0xdfff,
    expected: false,
  })
  assert({
    given: 'a surrogate-heavy transcript',
    should: 'still fit the budget',
    actual: transcript.length <= 8000,
    expected: true,
  })
})

test('buildChatTranscript - maxChars raises the packing budget', () => {
  const turns: ConversationMessage[] = Array.from({ length: 40 }, (_, i) =>
    msg(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}: ${'launch details '.repeat(40)}`),
  )
  const packed = buildChatTranscript(turns)
  const wide = buildChatTranscript(turns, { maxChars: 48_000 })
  assert({
    given: 'a chat well past the default 8k budget, packed at default and at 48k',
    should: 'clip the middle at default and keep the whole conversation at 48k',
    actual: {
      packedClipped: packed.includes('[... middle omitted ...]'),
      wideClipped: wide.includes('[... middle omitted ...]'),
      wideIsLonger: wide.length > packed.length,
    },
    expected: { packedClipped: true, wideClipped: false, wideIsLonger: true },
  })
})
