import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import ChatDocument from './mod.ts'
import type { ChatTurn } from './mod.ts'

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
        speaker: 'JP',
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
        speaker: 'JP',
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
        speaker: 'JP',
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
    should: 'have JP as first speaker',
    actual: doc.turns[0].speaker,
    expected: 'JP',
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
