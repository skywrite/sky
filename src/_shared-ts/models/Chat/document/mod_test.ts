import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import type { ConversationMessage } from '../type.d.ts'
import { serializeContextLog, splitContextLog } from './ContextLog/mod.ts'
import ChatDocument, { extractConversationSummary, firstWordsSummary, setUserSpeakerLabel } from './mod.ts'
import type { ChatTurn } from './mod.ts'

setUserSpeakerLabel('Jane')

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')

async function readFixture(name: string): Promise<string> {
  return await readTextFile(path.join(FIXTURES_DIR, name))
}

// --- YAML metadata ---

interface MetadataFixture {
  file: string
  description: string
  expectedSummary: string
  expectedProvider: string
  expectedModel: string
  expectedTurnCount: number
}

const metadataFixtures: MetadataFixture[] = [
  {
    file: 'simple-two-turns.md',
    description: 'simple two-turn chat',
    expectedSummary: 'Exploring the Future of Payments',
    expectedProvider: 'claude',
    expectedModel: 'claude-opus-4-6',
    expectedTurnCount: 2,
  },
  {
    file: 'multi-turn-with-subheadings.md',
    description: 'multi-turn with subheadings',
    expectedSummary: 'MCP vs x402 Analysis',
    expectedProvider: 'openai',
    expectedModel: 'gpt-5.2',
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
      should: 'return correct provider',
      actual: doc.provider,
      expected: fixture.expectedProvider,
    })
    assert({
      given: fixture.description,
      should: 'return correct model',
      actual: doc.model,
      expected: fixture.expectedModel,
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
      {
        speaker: 'Jane',
        content: 'What do you think about the future of payments?',
      },
      {
        speaker: 'AI Assistant',
        content:
          'Payments are evolving rapidly. Stablecoins and AI agents are likely to drive the next wave of innovation.',
      },
    ],
  },
  {
    file: 'multi-turn-with-subheadings.md',
    description: 'multi-turn with AI subheadings',
    expected: [
      {
        speaker: 'Jane',
        content: 'Help me compare MCP and x402 for agent payments.',
      },
      {
        speaker: 'AI Assistant',
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
      {
        speaker: 'Jane',
        content: 'Can you write a summary for the team?',
      },
      {
        speaker: 'AI Assistant',
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
      should: 'parse correct number of turns',
      actual: doc.turns.length,
      expected: fixture.expected.length,
    })
    for (let i = 0; i < fixture.expected.length; i++) {
      assert({
        given: `${fixture.description} turn ${i}`,
        should: `have speaker "${fixture.expected[i].speaker}"`,
        actual: doc.turns[i].speaker,
        expected: fixture.expected[i].speaker,
      })
      assert({
        given: `${fixture.description} turn ${i}`,
        should: 'have correct content',
        actual: doc.turns[i].content,
        expected: fixture.expected[i].content,
      })
    }
  })
})

// --- create() ---

test('ChatDocument.create - produces valid document', () => {
  const doc = ChatDocument.create({
    summary: 'Test Chat',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    created: '2026-02-10',
    updated: '2026-02-10',
    provider: 'claude',
    model: 'claude-opus-4-6',
  })

  assert({
    given: 'created ChatDocument',
    should: 'have correct summary',
    actual: doc.summary,
    expected: 'Test Chat',
  })

  assert({
    given: 'created ChatDocument',
    should: 'have correct provider',
    actual: doc.provider,
    expected: 'claude',
  })

  assert({
    given: 'created ChatDocument',
    should: 'have correct turnCount (1 exchange)',
    actual: doc.turnCount,
    expected: 1,
  })

  assert({
    given: 'created ChatDocument',
    should: 'have Jane as first speaker',
    actual: doc.turns[0].speaker,
    expected: 'Jane',
  })

  assert({
    given: 'created ChatDocument',
    should: 'have AI Assistant as second speaker',
    actual: doc.turns[1].speaker,
    expected: 'AI Assistant',
  })
})

// --- create() → toMarkdown() → fromMarkdown() roundtrip ---

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
    provider: 'openai',
    model: 'gpt-5.2',
    tags: ['Tech/AI'],
  })

  const reparsed = ChatDocument.fromMarkdown(doc.toMarkdown())

  assert({
    given: 're-parsed created document',
    should: 'return correct summary',
    actual: reparsed.summary,
    expected: 'Roundtrip Test',
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct provider',
    actual: reparsed.provider,
    expected: 'openai',
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct model',
    actual: reparsed.model,
    expected: 'gpt-5.2',
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct turnCount (2 exchanges)',
    actual: reparsed.turnCount,
    expected: 2,
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct number of turns',
    actual: reparsed.turns.length,
    expected: 4,
  })

  assert({
    given: 're-parsed created document',
    should: 'preserve first user content',
    actual: reparsed.turns[0].content,
    expected: 'What is 2+2?',
  })

  assert({
    given: 're-parsed created document',
    should: 'preserve last assistant content',
    actual: reparsed.turns[3].content,
    expected: "You're welcome.",
  })

  assert({
    given: 're-parsed created document',
    should: 'preserve tags',
    actual: Array.from(reparsed.tags),
    expected: ['Tech/AI'],
  })
})

// --- tag preservation (fromMarkdown → toMarkdown roundtrip) ---

test('ChatDocument - preserves existing tags through a parse/serialize roundtrip', () => {
  // Chat documents never write tags themselves — but tags added to a saved
  // chat (by hand, or carried through a future continue-conversation flow)
  // must survive re-serialization so tag search keeps finding the chat.
  const source = `---
created: 2026-02-10
updated: 2026-02-10
summary: Tagged Chat
provider: claude
model: claude-opus-4-6
turns: 1
tags: Acme/Marketing/Ideas; Acme/Company
---

# Tagged Chat

## Jane

A question.

## AI Assistant

An answer.`

  const doc = ChatDocument.fromMarkdown(source)

  assert({
    given: 'a chat file with semicolon-delimited tags',
    should: 'parse both tags',
    actual: Array.from(doc.tags),
    expected: ['Acme/Marketing/Ideas', 'Acme/Company'],
  })

  const serialized = doc.toMarkdown()

  assert({
    given: 'the re-serialized markdown',
    should: 'retain the tags line',
    actual: serialized.includes('tags: Acme/Marketing/Ideas; Acme/Company'),
    expected: true,
  })

  assert({
    given: 'a full parse/serialize/parse roundtrip',
    should: 'still expose both tags',
    actual: Array.from(ChatDocument.fromMarkdown(serialized).tags),
    expected: ['Acme/Marketing/Ideas', 'Acme/Company'],
  })
})

// --- strips SUMMARY comment on create ---

test('ChatDocument.create - strips SUMMARY comment from assistant content', () => {
  const doc = ChatDocument.create({
    summary: 'Summary Stripping Test',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Response text.\n\n<!-- SUMMARY: Some summary -->' },
    ],
    created: '2026-02-10',
    updated: '2026-02-10',
    provider: 'claude',
    model: 'claude-opus-4-6',
  })

  assert({
    given: 'assistant turn with SUMMARY comment',
    should: 'strip the comment',
    actual: doc.turns[0].content,
    expected: 'Hello',
  })

  // The actual markdown should not contain the comment
  assert({
    given: 'created document markdown',
    should: 'not contain SUMMARY comment',
    actual: doc.toMarkdown().includes('<!-- SUMMARY:'),
    expected: false,
  })
})

// --- conversation ---

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

test('ChatDocument.conversation - alternates through a multi-turn chat', async () => {
  const doc = ChatDocument.fromMarkdown(await readFixture('multi-turn-with-subheadings.md'))
  assert({
    given: 'a four-turn chat with H3 subheadings',
    should: 'produce four alternating messages',
    actual: doc.conversation.map((m) => m.role),
    expected: ['user', 'assistant', 'user', 'assistant'],
  })
  assert({
    given: 'a four-turn chat with H3 subheadings',
    should: 'keep subheadings inside the assistant content',
    actual: doc.conversation[1].content.includes('### Key Differences'),
    expected: true,
  })
})

test('ChatDocument.conversation - folds assistant-emitted H2 headings back into the reply', () => {
  const doc = ChatDocument.fromMarkdown(
    [
      '# Fold Test',
      '',
      '## Jane',
      '',
      'Compare the options.',
      '',
      '## AI Assistant',
      '',
      'Two options stand out.',
      '',
      '## Recommendation',
      '',
      'Go with the first option.',
      '',
      '## Jane',
      '',
      'Thanks.',
    ].join('\n'),
  )
  assert({
    given: 'an assistant reply containing a literal H2 heading',
    should: 'fold the phantom section back into the assistant message',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'Compare the options.' },
      { role: 'assistant', content: 'Two options stand out.\n\n## Recommendation\n\nGo with the first option.' },
      { role: 'user', content: 'Thanks.' },
    ],
  })
})

test('ChatDocument.conversation - merges consecutive same-role turns', () => {
  const doc = ChatDocument.fromMarkdown(
    [
      '# Merge Test',
      '',
      '## Jane',
      '',
      'First thought.',
      '',
      '## Jane',
      '',
      'Second thought.',
      '',
      '## AI Assistant',
      '',
      'Answer.',
    ].join('\n'),
  )
  assert({
    given: 'two consecutive user turns',
    should: 'merge them into one user message so roles alternate',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'First thought.\n\nSecond thought.' },
      { role: 'assistant', content: 'Answer.' },
    ],
  })
})

// --- turn stamps ---

test('ChatDocument - turn stamps round-trip through headings', () => {
  const doc = ChatDocument.create({
    summary: 'Stamped Chat',
    messages: [
      { role: 'user', content: 'Morning question.', when: '2026-02-08 09:12' },
      { role: 'assistant', content: 'Morning answer.', when: '2026-02-08 09:13' },
      { role: 'user', content: 'Late-night follow-up.', when: '2026-02-08 25:30' },
      { role: 'assistant', content: 'Late-night answer.', when: '2026-02-08 25:31' },
    ],
    created: '2026-02-08',
    updated: '2026-02-08',
    provider: 'claude',
    model: 'claude-opus-4-6',
  })

  const markdown = doc.toMarkdown()
  assert({
    given: 'stamped messages',
    should: 'write message-file headings — leading stamp, bold speaker',
    actual: [
      markdown.includes('## 2026-02-08 09:12 - **Jane**'),
      markdown.includes('## 2026-02-08 09:13 - **AI Assistant**'),
      markdown.includes('## 2026-02-08 25:30 - **Jane**'),
    ],
    expected: [true, true, true],
  })

  assert({
    given: 'the re-parsed markdown',
    should: 'restore stamps (extended hours intact) with clean content',
    actual: ChatDocument.fromMarkdown(markdown).conversation,
    expected: [
      { role: 'user', content: 'Morning question.', when: '2026-02-08 09:12' },
      { role: 'assistant', content: 'Morning answer.', when: '2026-02-08 09:13' },
      { role: 'user', content: 'Late-night follow-up.', when: '2026-02-08 25:30' },
      { role: 'assistant', content: 'Late-night answer.', when: '2026-02-08 25:31' },
    ],
  })
})

test('ChatDocument - unstamped headings parse with no when key, stamped and bare headings mix', () => {
  const doc = ChatDocument.fromMarkdown(
    [
      '# Resumed Chat',
      '',
      '## Jane',
      '',
      'Old question.',
      '',
      '## AI Assistant',
      '',
      'Old answer.',
      '',
      '## 2026-02-08 14:32 - **Jane**',
      '',
      'New question.',
    ].join('\n'),
  )
  assert({
    given: 'a pre-stamp transcript continued with stamped turns',
    should: 'leave old messages unstamped and stamp the new one',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'Old question.' },
      { role: 'assistant', content: 'Old answer.' },
      { role: 'user', content: 'New question.', when: '2026-02-08 14:32' },
    ],
  })
  assert({
    given: 'a bare `## Jane` heading',
    should: 'not set the when key at all',
    actual: 'when' in doc.conversation[0],
    expected: false,
  })
})

test('ChatDocument - a stamp-shaped heading on a non-speaker still folds back', () => {
  const doc = ChatDocument.fromMarkdown(
    [
      '# Fold Test',
      '',
      '## 2026-02-08 14:32 - **Jane**',
      '',
      'Compare the options.',
      '',
      '## 2026-02-08 14:33 - **AI Assistant**',
      '',
      'Two options stand out.',
      '',
      '## 2026-02-08 14:33 - **Recommendation**',
      '',
      'Go with the first option.',
    ].join('\n'),
  )
  assert({
    given: 'an assistant reply containing an H2 with a stamp-looking prefix',
    should: 'fold the phantom section back, keeping real speaker stamps',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'Compare the options.', when: '2026-02-08 14:32' },
      {
        role: 'assistant',
        content: 'Two options stand out.\n\n## 2026-02-08 14:33 - **Recommendation**\n\nGo with the first option.',
        when: '2026-02-08 14:33',
      },
    ],
  })
})

test('ChatDocument - legacy trailing-paren stamps still parse', () => {
  const doc = ChatDocument.fromMarkdown(
    [
      '# Legacy Stamps',
      '',
      '## Jane (2026-02-08 14:32)',
      '',
      'Old-format question.',
      '',
      '## AI Assistant (2026-02-08 14:33)',
      '',
      'Old-format answer.',
    ].join('\n'),
  )
  assert({
    given: 'a transcript from the trailing-paren stamp era',
    should: 'restore the stamps as when keys',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'Old-format question.', when: '2026-02-08 14:32' },
      { role: 'assistant', content: 'Old-format answer.', when: '2026-02-08 14:33' },
    ],
  })
})

// --- extractConversationSummary ---

test('extractConversationSummary - latest SUMMARY comment wins, fallback covers resumes', () => {
  const withComment: ConversationMessage[] = [
    { role: 'user', content: 'First question.' },
    { role: 'assistant', content: 'Answer.\n\n<!-- SUMMARY: Early Topic -->' },
    { role: 'user', content: 'Second question.' },
    { role: 'assistant', content: 'Answer two.\n\n<!-- SUMMARY: Evolved Topic -->' },
  ]
  assert({
    given: 'two assistant SUMMARY comments',
    should: 'take the latest',
    actual: extractConversationSummary(withComment, 'Original Summary'),
    expected: 'Evolved Topic',
  })

  const noComment: ConversationMessage[] = [
    { role: 'user', content: 'A question with quite a few words in it here.' },
    { role: 'assistant', content: 'An answer without any summary comment.' },
  ]
  assert({
    given: 'no SUMMARY comment but a resume fallback',
    should: 'keep the original summary instead of guessing from first words',
    actual: extractConversationSummary(noComment, 'Original Summary'),
    expected: 'Original Summary',
  })
  assert({
    given: 'no SUMMARY comment and no fallback',
    should: 'fall back to the first ten words of the first user message',
    actual: extractConversationSummary(noComment),
    expected: 'A question with quite a few words in it here.',
  })
  assert({
    given: 'an empty-string fallback',
    should: 'ignore it and use first words',
    actual: extractConversationSummary(noComment, ''),
    expected: 'A question with quite a few words in it here.',
  })
})

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

test('ChatDocument - a v2 transcript parses conversation and log cleanly', async () => {
  const doc = ChatDocument.fromMarkdown(await readFixture('two-turns-with-context-log-v2.md'))

  assert({
    given: 'a saved chat with a trailing CONTEXT-LOG comment',
    should: 'expose the conversation without any log debris',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'What should I focus on for the Atlas launch this week?' },
      { role: 'assistant', content: 'Focus on the demo script and the pricing page copy.' },
      { role: 'user', content: 'Draft the announcement outline.' },
      { role: 'assistant', content: 'Here is an outline: intro, demo, pricing, call to action.' },
    ],
  })

  assert({
    given: 'a saved chat with a trailing CONTEXT-LOG comment',
    should: 'parse both log entries',
    actual: doc.contextLog.map((e) => e.turn),
    expected: [1, 2],
  })

  // The fixture must be byte-for-byte what the ai:chat writer produces —
  // this law is what makes resume's read side trustworthy against real files.
  const { body, entries } = splitContextLog(doc.markdown)
  assert({
    given: 'the fixture body markdown',
    should: 'reassemble byte-identically from body + serialized log',
    actual: body + serializeContextLog(entries),
    expected: doc.markdown,
  })
})

test('ChatDocument - a legacy TURN-log transcript keeps a clean conversation, no entries', async () => {
  const doc = ChatDocument.fromMarkdown(await readFixture('two-turns-with-context-log.md'))

  assert({
    given: 'a saved chat with legacy trailing TURN comments',
    should: 'expose the conversation without any log debris',
    actual: doc.conversation,
    expected: [
      { role: 'user', content: 'What should I focus on for the Atlas launch this week?' },
      { role: 'assistant', content: 'Focus on the demo script and the pricing page copy.' },
      { role: 'user', content: 'Draft the announcement outline.' },
      { role: 'assistant', content: 'Here is an outline: intro, demo, pricing, call to action.' },
    ],
  })

  assert({
    given: 'a saved chat with legacy trailing TURN comments',
    should: 'parse no entries — the pre-JSON format is detected, never read',
    actual: doc.contextLog,
    expected: [],
  })
})
