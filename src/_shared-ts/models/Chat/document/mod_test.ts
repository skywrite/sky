import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import type { ConversationMessage } from '../type.d.ts'
import { serializeContextLog, splitContextLog } from './ContextLog/mod.ts'
import ChatDocument, { firstWordsSummary, setUserSpeakerLabel } from './mod.ts'
import type { ChatTurn } from './mod.ts'

setUserSpeakerLabel('Jane')

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')

async function readFixture(name: string): Promise<string> {
  return await readTextFile(path.join(FIXTURES_DIR, name))
}

/** A transcript in the current shape, title then the Conversation section. */
const transcript = (title: string, ...lines: string[]) => [`# ${title}`, '', '## Conversation', '', ...lines].join('\n')

// --- YAML metadata ---

interface MetadataFixture {
  file: string
  description: string
  expectedSummary: string
  expectedTurnCount: number
}

const metadataFixtures: MetadataFixture[] = [
  {
    file: 'simple-two-turns.md',
    description: 'simple two-turn chat',
    expectedSummary: 'Exploring the Future of Payments',
    expectedTurnCount: 2,
  },
  {
    file: 'multi-turn-with-subheadings.md',
    description: 'multi-turn with subheadings',
    expectedSummary: 'MCP vs x402 Analysis',
    expectedTurnCount: 4,
  },
]

metadataFixtures.forEach((fixture) => {
  test(`ChatDocument metadata - ${fixture.description}`, async () => {
    const doc = ChatDocument.fromMarkdown(await readFixture(fixture.file))
    assert({
      given: fixture.description,
      should: 'return correct summary',
      actual: doc.summary,
      expected: fixture.expectedSummary,
    })
    assert({
      given: fixture.description,
      should: 'return correct turnCount',
      actual: doc.turnCount,
      expected: fixture.expectedTurnCount,
    })
  })
})

// --- turns ---

interface TurnFixture {
  file: string
  description: string
  expected: ChatTurn[]
}

const turnFixtures: TurnFixture[] = [
  {
    file: 'simple-two-turns.md',
    description: 'simple two turns',
    expected: [
      { speaker: '**Jane**', content: 'What do you think about the future of payments?' },
      {
        speaker: '**Sky**',
        content:
          'Payments are evolving rapidly. Stablecoins and AI agents are likely to drive the next wave of innovation.',
      },
    ],
  },
  {
    file: 'multi-turn-with-subheadings.md',
    description: 'multi-turn with reply subheadings',
    expected: [
      { speaker: '**Jane**', content: 'Help me compare MCP and x402 for agent payments.' },
      {
        speaker: '**Sky**',
        content: [
          'Great question. Let me break this down.',
          '',
          '### Key Differences',
          '',
          'MCP is session-based while x402 is stateless. This matters because:',
          '',
          '- Sessions allow tab-and-settle patterns',
          '- Stateless means pay-per-request overhead',
          '',
          '### Recommendation',
          '',
          'MCP is the better fit for AI agent payments.',
        ].join('\n'),
      },
      { speaker: '**Jane**', content: 'Can you write a summary for the team?' },
      {
        speaker: '**Sky**',
        content: [
          "Here's a draft:",
          '',
          '**MCP > x402 for Agent Payments**',
          '',
          "The key insight is that MCP's session model maps naturally to how agents consume services.",
        ].join('\n'),
      },
    ],
  },
]

turnFixtures.forEach((fixture) => {
  test(`ChatDocument.turns - ${fixture.description}`, async () => {
    const doc = ChatDocument.fromMarkdown(await readFixture(fixture.file))
    assert({
      given: fixture.description,
      should: 'read every message under its speaker, a reply keeping its own headings',
      actual: doc.turns,
      expected: fixture.expected,
    })
  })
})

// --- create() ---

test('ChatDocument.create - every message goes under the Conversation section, at H3', () => {
  const doc = ChatDocument.create({
    summary: 'Test Chat',
    messages: [
      { role: 'user', content: 'Hello', when: '2026-02-10 09:00' },
      { role: 'assistant', content: 'Hi there!', when: '2026-02-10 09:01' },
    ],
    created: '2026-02-10',
    updated: '2026-02-10',
  })
  assert({
    given: 'a created two-message chat',
    should: 'write the title, then the Conversation section, then one H3 per message',
    actual: { body: doc.markdown, turnCount: doc.turnCount, speakers: doc.turns.map((t) => t.speaker) },
    expected: {
      body: [
        '',
        '# Test Chat',
        '',
        '## Conversation',
        '',
        '### 2026-02-10 09:00 - **Jane**',
        '',
        'Hello',
        '',
        '### 2026-02-10 09:01 - **Sky**',
        '',
        'Hi there!',
        '',
      ].join('\n'),
      turnCount: 1,
      speakers: ['2026-02-10 09:00 - **Jane**', '2026-02-10 09:01 - **Sky**'],
    },
  })
})

test('ChatDocument.create - roundtrip preserves data', () => {
  const doc = ChatDocument.create({
    summary: 'Roundtrip Test',
    messages: [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: 'The answer is 4.' },
      { role: 'user', content: 'Thanks!' },
      { role: 'assistant', content: "You're welcome." },
    ],
    created: '2026-02-10',
    updated: '2026-02-10',
    tags: ['Tech/AI'],
  })
  const reparsed = ChatDocument.fromMarkdown(doc.toMarkdown())
  assert({
    given: 're-parsed created document',
    should: 'return the summary, exchange count, messages and tags it was created with',
    actual: {
      summary: reparsed.summary,
      turnCount: reparsed.turnCount,
      conversation: reparsed.conversation,
      tags: Array.from(reparsed.tags),
    },
    expected: {
      summary: 'Roundtrip Test',
      turnCount: 2,
      conversation: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: 'The answer is 4.' },
        { role: 'user', content: 'Thanks!' },
        { role: 'assistant', content: "You're welcome." },
      ],
      tags: ['Tech/AI'],
    },
  })
})

test('ChatDocument.create - a reply keeps its own headings, any level, exactly as written', () => {
  const reply = [
    'Two options stand out.',
    '',
    '## Recommendation',
    '',
    'Go with the first.',
    '',
    '### 2026-02-10 09:02 - **Recommendation**',
    '',
    '# Appendix',
    '',
    '```',
    '### 2026-02-10 09:03 - **Jane**',
    '```',
  ].join('\n')
  const messages: ConversationMessage[] = [
    { role: 'user', content: 'Compare the options.', when: '2026-02-10 09:00' },
    { role: 'assistant', content: reply, when: '2026-02-10 09:01' },
    { role: 'user', content: 'Thanks.', when: '2026-02-10 09:05' },
  ]
  const doc = ChatDocument.create({ summary: 'Headings', messages, created: '2026-02-10', updated: '2026-02-10' })
  assert({
    given: 'a reply with H1, H2 and stamp-shaped H3 headings of its own, and a speaker heading quoted in a code block',
    should: 'read back the same three messages, the reply byte for byte',
    actual: ChatDocument.fromMarkdown(doc.toMarkdown()).conversation,
    expected: messages,
  })
})

// --- reading ---

test('ChatDocument - tags survive a parse/serialize roundtrip', () => {
  const source = `---
created: 2026-02-10
updated: 2026-02-10
summary: Tagged Chat
turns: 1
tags: Acme/Marketing/Ideas; Acme/Company
---

${transcript('Tagged Chat', '### **Jane**', '', 'A question.', '', '### **Sky**', '', 'An answer.')}`
  const serialized = ChatDocument.fromMarkdown(source).toMarkdown()
  assert({
    given: 'a chat file with semicolon-delimited tags, re-serialized',
    should: 'retain the tags line and expose both tags',
    actual: {
      line: serialized.includes('tags: Acme/Marketing/Ideas; Acme/Company'),
      tags: Array.from(ChatDocument.fromMarkdown(serialized).tags),
    },
    expected: { line: true, tags: ['Acme/Marketing/Ideas', 'Acme/Company'] },
  })
})

test('ChatDocument.conversation - maps speakers to roles', async () => {
  const doc = ChatDocument.fromMarkdown(await readFixture('simple-two-turns.md'))
  assert({
    given: 'a simple two-turn chat',
    should: 'produce role-tagged messages',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'What do you think about the future of payments?' },
      {
        role: 'assistant',
        content:
          'Payments are evolving rapidly. Stablecoins and AI agents are likely to drive the next wave of innovation.',
      },
    ],
  })
})

test('ChatDocument.conversation - merges consecutive same-role messages, keeping the first stamp', () => {
  const doc = ChatDocument.fromMarkdown(
    transcript(
      'Merge Test',
      '### 2026-02-08 09:00 - **Jane**',
      '',
      'First thought.',
      '',
      '### 2026-02-08 09:01 - **Jane**',
      '',
      'Second thought.',
      '',
      '### 2026-02-08 09:02 - **Sky**',
      '',
      'Answer.',
    ),
  )
  assert({
    given: 'two consecutive user messages',
    should: 'merge them into one user message so roles alternate',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'First thought.\n\nSecond thought.', when: '2026-02-08 09:00' },
      { role: 'assistant', content: 'Answer.', when: '2026-02-08 09:02' },
    ],
  })
})

test('ChatDocument.conversation - only the Conversation section is conversation', () => {
  const doc = ChatDocument.fromMarkdown(
    [
      '# Sectioned',
      '',
      '## Summary',
      '',
      '### **Jane**',
      '',
      'Text above the conversation is never a message.',
      '',
      '## Conversation',
      '',
      '### **Jane**',
      '',
      'The question.',
      '',
      '### **Sky**',
      '',
      'The answer.',
    ].join('\n'),
  )
  assert({
    given: 'a speaker-shaped heading in a section above Conversation',
    should: 'read only the messages after the Conversation heading',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'The question.' },
      { role: 'assistant', content: 'The answer.' },
    ],
  })
})

test('ChatDocument.create - a summary goes between the title and the Conversation section', () => {
  const doc = ChatDocument.create({
    summary: 'Test Chat',
    messages: [
      { role: 'user', content: 'Hello', when: '2026-02-10 09:00' },
      { role: 'assistant', content: 'Hi there!', when: '2026-02-10 09:01' },
    ],
    created: '2026-02-10',
    updated: '2026-02-10',
    summarySection: { by: 'Opus 5.5, High', text: 'Jane said hello. Sky answered.' },
  })
  const reread = ChatDocument.fromMarkdown(doc.toMarkdown())
  assert({
    given: 'a created chat with a summary',
    should: 'write it under a heading naming its writer, above the messages, and read both back',
    actual: {
      head: doc.markdown.split('### ')[0],
      summary: reread.summarySection,
      conversation: reread.conversation.map((m) => m.content),
    },
    expected: {
      head: [
        '',
        '# Test Chat',
        '',
        '## Summary (Opus 5.5, High)',
        '',
        'Jane said hello. Sky answered.',
        '',
        '## Conversation',
        '',
        '',
      ].join('\n'),
      summary: { by: 'Opus 5.5, High', text: 'Jane said hello. Sky answered.' },
      conversation: ['Hello', 'Hi there!'],
    },
  })
})

test('ChatDocument.summarySection - only the section above the conversation, named or bare', () => {
  const bare = ChatDocument.fromMarkdown(
    ['# Chat', '', '## Summary', '', 'Written by hand.', '', '## Conversation', '', '### **Jane**', '', 'Hi.'].join(
      '\n',
    ),
  )
  const inReply = ChatDocument.fromMarkdown(
    transcript('Chat', '### **Jane**', '', 'Hi.', '', '### **Sky**', '', '## Summary (Opus 5.5, High)', '', 'A reply.'),
  )
  const none = ChatDocument.fromMarkdown(transcript('Chat', '### **Jane**', '', 'Hi.'))
  assert({
    given: 'a bare Summary heading, a Summary heading inside a reply, and no summary at all',
    should: 'read the bare one with no writer, and no section for the other two',
    actual: [bare.summarySection, inReply.summarySection, none.summarySection],
    expected: [{ by: null, text: 'Written by hand.' }, null, null],
  })
})

test('ChatDocument - turn stamps round-trip through headings, extended hours intact', () => {
  const messages: ConversationMessage[] = [
    { role: 'user', content: 'Morning question.', when: '2026-02-08 09:12' },
    { role: 'assistant', content: 'Morning answer.', when: '2026-02-08 09:13' },
    { role: 'user', content: 'Late-night follow-up.', when: '2026-02-08 25:30' },
    { role: 'assistant', content: 'Late-night answer.', when: '2026-02-08 25:31' },
  ]
  const markdown = ChatDocument.create({
    summary: 'Stamped Chat',
    messages,
    created: '2026-02-08',
    updated: '2026-02-08',
  }).toMarkdown()
  assert({
    given: 'stamped messages',
    should: 'write leading-stamp H3 headings and read the same messages back',
    actual: {
      headings: [
        markdown.includes('### 2026-02-08 25:30 - **Jane**'),
        markdown.includes('### 2026-02-08 09:13 - **Sky**'),
      ],
      conversation: ChatDocument.fromMarkdown(markdown).conversation,
    },
    expected: { headings: [true, true], conversation: messages },
  })
})

test('ChatDocument - unstamped headings parse with no when key, stamped and bare headings mix', () => {
  const doc = ChatDocument.fromMarkdown(
    transcript(
      'Resumed Chat',
      '### **Jane**',
      '',
      'Old question.',
      '',
      '### **Sky**',
      '',
      'Old answer.',
      '',
      '### 2026-02-08 14:32 - **Jane**',
      '',
      'New question.',
    ),
  )
  assert({
    given: 'a pre-stamp transcript continued with stamped messages',
    should: 'leave old messages unstamped, without a when key, and stamp the new one',
    actual: { conversation: doc.conversation, firstHasWhen: 'when' in doc.conversation[0]! },
    expected: {
      conversation: [
        { role: 'user', content: 'Old question.' },
        { role: 'assistant', content: 'Old answer.' },
        { role: 'user', content: 'New question.', when: '2026-02-08 14:32' },
      ],
      firstHasWhen: false,
    },
  })
})

test('ChatDocument - a file in the earlier shape reads as no conversation and says so', () => {
  const earlier = ChatDocument.fromMarkdown(
    [
      '# Earlier',
      '',
      '## 2026-02-08 14:32 - **Jane**',
      '',
      'A question.',
      '',
      '## 2026-02-08 14:33 - **AI Assistant**',
      '',
      'An answer.',
    ].join('\n'),
  )
  const current = ChatDocument.fromMarkdown(transcript('Current', '### **Jane**', '', 'A question.'))
  const neither = ChatDocument.fromMarkdown('# Notes\n\nNo conversation here.\n')
  assert({
    given: 'a transcript with H2 speaker headings and no Conversation section, a current one, and a non-chat note',
    should: 'read no messages from the earlier one and flag only it',
    actual: {
      earlier: { messages: earlier.conversation.length, legacy: earlier.legacyShape },
      current: { messages: current.conversation.length, legacy: current.legacyShape },
      neither: neither.legacyShape,
    },
    expected: { earlier: { messages: 0, legacy: true }, current: { messages: 1, legacy: false }, neither: false },
  })
})

// --- firstWordsSummary ---

test('firstWordsSummary - first user message, capped at ten words', () => {
  assert({
    given: 'a long first user message',
    should: 'keep only its first ten words',
    actual: firstWordsSummary([
      { role: 'user', content: 'one two three four five six seven eight nine ten eleven twelve' },
      { role: 'assistant', content: 'An answer.' },
    ]),
    expected: 'one two three four five six seven eight nine ten',
  })
  assert({
    given: 'a conversation with no user message',
    should: 'return an empty string',
    actual: firstWordsSummary([{ role: 'assistant', content: 'Unprompted.' }]),
    expected: '',
  })
})

// --- contextLog + conversation on a saved transcript ---

const SAVED_CONVERSATION: ConversationMessage[] = [
  { role: 'user', content: 'What should I focus on for the Atlas launch this week?' },
  { role: 'assistant', content: 'Focus on the demo script and the pricing page copy.' },
  { role: 'user', content: 'Draft the announcement outline.' },
  { role: 'assistant', content: 'Here is an outline: intro, demo, pricing, call to action.' },
]

test('ChatDocument - a v2 transcript parses conversation and log cleanly', async () => {
  const doc = ChatDocument.fromMarkdown(await readFixture('two-turns-with-context-log-v2.md'))
  // The fixture must be byte-for-byte what the ai:chat writer produces —
  // this law is what makes resume's read side trustworthy against real files.
  const { body, entries } = splitContextLog(doc.markdown)
  assert({
    given: 'a saved chat with a trailing CONTEXT-LOG comment',
    should: 'expose the conversation without log debris, parse both entries, and reassemble byte-identically',
    actual: {
      conversation: doc.conversation,
      turns: doc.contextLog.map((e) => e.turn),
      reassembled: body + serializeContextLog(entries) === doc.markdown,
    },
    expected: { conversation: SAVED_CONVERSATION, turns: [1, 2], reassembled: true },
  })
})

test('ChatDocument - a legacy TURN-log transcript keeps a clean conversation, no entries', async () => {
  const doc = ChatDocument.fromMarkdown(await readFixture('two-turns-with-context-log.md'))
  assert({
    given: 'a saved chat with legacy trailing TURN comments',
    should: 'expose the conversation without log debris, and parse no entries',
    actual: { conversation: doc.conversation, log: doc.contextLog },
    expected: { conversation: SAVED_CONVERSATION, log: [] },
  })
})

test('ChatDocument.create - approvals round-trip and default to empty', () => {
  const doc = ChatDocument.create({
    summary: 'Approvals Test',
    messages: [
      { role: 'user', content: 'Edit the plan doc.' },
      { role: 'assistant', content: 'Done.' },
    ],
    created: '2026-09-01',
    updated: '2026-09-01',
    approvals: ['google_agent:f123abc'],
  })
  const bare = ChatDocument.create({
    summary: 'No Approvals',
    messages: [{ role: 'user', content: 'hi' }],
    created: '2026-09-01',
    updated: '2026-09-01',
  })
  assert({
    given: 'a document created with durable approval keys, and one created without',
    should: 'read the keys back after a round-trip, and omit the key when there are none',
    actual: {
      approvals: ChatDocument.fromMarkdown(doc.toMarkdown()).approvals,
      bareHasKey: 'approvals' in bare.yaml,
      bareApprovals: ChatDocument.fromMarkdown(bare.toMarkdown()).approvals,
    },
    expected: { approvals: ['google_agent:f123abc'], bareHasKey: false, bareApprovals: [] },
  })
})
