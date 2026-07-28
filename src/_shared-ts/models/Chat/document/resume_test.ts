import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import ChatDocument from './mod.ts'
import { serializeContextLog } from './contextLog.ts'
import { reconstructResumeState, verifyResumeCandidate } from './resume.ts'
import type { ConversationMessage } from '../type.d.ts'

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')

async function readFixture(name: string): Promise<ChatDocument> {
  return ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, name)))
}

test('reconstructResumeState - unions CONTEXT and DIFFs into the universe', async () => {
  const state = reconstructResumeState(await readFixture('context-log-full.md'))

  assert({
    given: 'a three-turn log with CONTEXT and a DIFF',
    should: 'restore the full recorded universe in first-seen order',
    actual: state.universePaths,
    expected: [
      'goals/2026.md',
      'projects/Atlas/beta-feedback.md',
      'time/2026/03-March/12/journal/entry.md',
      'decisions/pricing-tier.md',
    ],
  })

  assert({
    given: 'a log whose last entry is a bare TURN comment',
    should: 'take the query set from the highest-turn entry, even when empty',
    actual: state.queries,
    expected: [],
  })

  assert({
    given: 'a three-turn log',
    should: 'continue numbering from the last recorded turn',
    actual: state.lastTurn,
    expected: 3,
  })

  assert({
    given: 'a three-exchange transcript',
    should: 'reconstruct the full conversation',
    actual: state.conversation.map((m) => m.role),
    expected: ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'],
  })

  assert({
    given: 'a parsed transcript',
    should: 'carry the TURN log forward for re-saving',
    actual: state.contextLog.map((e) => e.turn),
    expected: [1, 2, 3],
  })
})

test('reconstructResumeState - carries the live query set from the last turn', async () => {
  const state = reconstructResumeState(await readFixture('two-turns-with-context-log.md'))
  assert({
    given: 'a log whose turn 2 evolved to two queries',
    should: 'seed evolve with both',
    actual: state.queries,
    expected: [
      '{ documents(where: { bodyContains: "Atlas" }) { path } }',
      '{ decisions(where: { pending: true }) { path } }',
    ],
  })
  assert({
    given: 'turn-1 CONTEXT plus a turn-2 DIFF',
    should: 'restore all four universe paths',
    actual: state.universePaths.length,
    expected: 4,
  })
})

test('reconstructResumeState - empty CONTEXT restores an empty universe', async () => {
  const state = reconstructResumeState(await readFixture('context-log-empty-context.md'))
  assert({
    given: 'a chat that gathered nothing',
    should: 'restore no universe paths',
    actual: state.universePaths,
    expected: [],
  })
  assert({
    given: 'a chat that gathered nothing but did query',
    should: 'still seed the recorded query',
    actual: state.queries,
    expected: ['{ documents(where: { bodyContains: "kickoff" }) { path } }'],
  })
})

test('reconstructResumeState - multi-line queries survive reconstruction', async () => {
  const state = reconstructResumeState(await readFixture('context-log-multiline-items.md'))
  assert({
    given: 'a pretty-printed GraphQL query in the log',
    should: 'seed it with embedded newlines intact',
    actual: state.queries,
    expected: ['{\n  projects(where: { nameContains: "Atlas" }) {\n    path\n  }\n}'],
  })
})

test('reconstructResumeState - a transcript without a TURN log degrades cleanly', async () => {
  const state = reconstructResumeState(await readFixture('simple-two-turns.md'))
  assert({
    given: 'an old-format chat with no TURN comments',
    should: 'reconstruct the conversation alone',
    actual: state.conversation.length,
    expected: 2,
  })
  assert({
    given: 'an old-format chat with no TURN comments',
    should: 'report no recorded context state',
    actual: { universePaths: state.universePaths, queries: state.queries, lastTurn: state.lastTurn },
    expected: { universePaths: [], queries: [], lastTurn: 0 },
  })
})

test('reconstructResumeState - duplicate paths in a hand-edited log are deduped', () => {
  // Not writer-canonical (DIFF records only additions) — defensive only.
  const doc = ChatDocument.fromMarkdown(
    [
      '# Dedupe Test',
      '',
      '## JP',
      '',
      'Question.',
      '',
      '## AI Assistant',
      '',
      'Answer.',
      '',
      '',
      '',
      '<!-- TURN 1',
      'CONTEXT:',
      ' - projects/Atlas/plan.md',
      '-->',
      '',
      '<!-- TURN 2',
      'DIFF:',
      ' + projects/Atlas/plan.md',
      ' + goals/2026.md',
      '-->',
      '',
    ].join('\n'),
  )
  assert({
    given: 'a DIFF repeating a CONTEXT path',
    should: 'keep the universe deduped',
    actual: reconstructResumeState(doc).universePaths,
    expected: ['projects/Atlas/plan.md', 'goals/2026.md'],
  })
})

// --- verifyResumeCandidate (the write-back gate) ---

/** Build candidate markdown the way the ai:chat save path does. */
function buildCandidate(
  messages: ConversationMessage[],
  contextLog: Parameters<typeof serializeContextLog>[0],
): string {
  const doc = ChatDocument.create({
    summary: 'Atlas Launch Planning',
    messages,
    created: '2026-03-05',
    updated: '2026-03-06',
    provider: 'claude',
    model: 'claude-opus-4-6',
  })
  return doc.toMarkdown() + serializeContextLog(contextLog)
}

test('verifyResumeCandidate - accepts a faithful continuation', async () => {
  const original = reconstructResumeState(
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log.md'))),
  )
  const candidate = buildCandidate(
    [
      ...original.conversation,
      { role: 'user', content: 'One more question.' },
      { role: 'assistant', content: 'One more answer.' },
    ],
    [...original.contextLog, { turn: 3, queries: [], pruned: [] }],
  )
  assert({
    given: 'the original conversation plus a new exchange and log entry',
    should: 'pass the gate',
    actual: verifyResumeCandidate(candidate, original),
    expected: { ok: true },
  })
})

test('verifyResumeCandidate - rejects a mutated original message', async () => {
  const original = reconstructResumeState(
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log.md'))),
  )
  const tampered = original.conversation.map((m, i) => (i === 1 ? { ...m, content: 'Rewritten history.' } : m))
  const candidate = buildCandidate(tampered, original.contextLog)
  assert({
    given: 'a candidate whose second message was rewritten',
    should: 'refuse the write',
    actual: verifyResumeCandidate(candidate, original),
    expected: { ok: false, reason: 'message 2 content diverged' },
  })
})

test('verifyResumeCandidate - rejects a shrunken context log', async () => {
  const original = reconstructResumeState(
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log.md'))),
  )
  const candidate = buildCandidate(original.conversation, original.contextLog.slice(0, 1))
  assert({
    given: 'a candidate that dropped a carried TURN entry',
    should: 'refuse the write',
    actual: verifyResumeCandidate(candidate, original),
    expected: { ok: false, reason: 'context log shrank: 1 < 2 entries' },
  })
})

test('verifyResumeCandidate - allows the trailing-user merge of an interrupted chat', () => {
  const original = reconstructResumeState(ChatDocument.fromMarkdown('# Interrupted\n\n## JP\n\nOnly question.'))
  const merged = buildCandidate(
    [
      { role: 'user', content: 'Only question.\n\nFollow-up thought.' },
      { role: 'assistant', content: 'Answer to both.' },
    ],
    [],
  )
  assert({
    given: 'an original ending in a user message, continued by merging',
    should: 'pass the gate',
    actual: verifyResumeCandidate(merged, original),
    expected: { ok: true },
  })

  const replaced = buildCandidate(
    [
      { role: 'user', content: 'A different question entirely.' },
      { role: 'assistant', content: 'Answer.' },
    ],
    [],
  )
  assert({
    given: 'an original ending in a user message that the candidate replaced',
    should: 'refuse the write',
    actual: verifyResumeCandidate(replaced, original),
    expected: { ok: false, reason: 'message 1 content diverged' },
  })
})
