import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import type { ConversationMessage } from '../type.d.ts'
import { serializeContextLog } from './ContextLog/mod.ts'
import ChatDocument, { setUserSpeakerLabel } from './mod.ts'
import { reconstructResumeState, verifyResumeCandidate } from './resume.ts'

setUserSpeakerLabel('Jane')

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')
const LOG_FIXTURES_DIR = path.join(import.meta.dirname!, 'ContextLog', 'fixtures')

async function readFixture(name: string, dir = FIXTURES_DIR): Promise<ChatDocument> {
  return ChatDocument.fromMarkdown(await readTextFile(path.join(dir, name)))
}

test('reconstructResumeState - unions universe, diffs, and pruned into the universe', async () => {
  const state = reconstructResumeState(await readFixture('context-log-v2.md', LOG_FIXTURES_DIR))

  assert({
    given: 'a two-turn v2 log with universe, diff, and a pruned repeat',
    should: 'restore the deduped universe in first-seen order',
    actual: state.universePaths,
    expected: [
      'goals/2026.md',
      'projects/Atlas/launch-plan.md',
      'time/2026/05/25-31/05-28/actions/notes/Atlas-Beta-Findings.md',
      'time/2026/06/01-07/06-02/journal/08_focus_Planning-The-Atlas-Beta.md',
      'people/2020/ja/Jane-Doe.md',
    ],
  })

  assert({
    given: 'a log whose turn 2 evolved to two queries',
    should: 'take the query set from the highest-turn entry',
    actual: state.queries,
    expected: [
      '{ projects(where: { nameContains: "Atlas" }) { path } }',
      '{ people(where: { nameContains: "Jane Doe" }) { path } }',
    ],
  })

  assert({
    given: 'a two-turn log',
    should: 'continue numbering from the last recorded turn',
    actual: state.lastTurn,
    expected: 2,
  })

  assert({
    given: 'a two-exchange transcript',
    should: 'reconstruct the full conversation',
    actual: state.conversation.map((m) => m.role),
    expected: ['user', 'assistant', 'user', 'assistant'],
  })

  assert({
    given: 'a parsed transcript',
    should: 'carry the log forward for re-saving',
    actual: state.contextLog.map((e) => e.turn),
    expected: [1, 2],
  })
})

test('reconstructResumeState - a legacy TURN-format transcript degrades to no log', async () => {
  const state = reconstructResumeState(await readFixture('context-log-full.md', LOG_FIXTURES_DIR))
  assert({
    given: 'a legacy transcript with TURN comments',
    should: 'reconstruct the conversation alone',
    actual: state.conversation.length,
    expected: 6,
  })
  assert({
    given: 'a legacy transcript with TURN comments',
    should: 'report no recorded context state (fresh gather on resume)',
    actual: { universePaths: state.universePaths, queries: state.queries, lastTurn: state.lastTurn },
    expected: { universePaths: [], queries: [], lastTurn: 0 },
  })
})

test('reconstructResumeState - a transcript without a log degrades cleanly', async () => {
  const state = reconstructResumeState(await readFixture('simple-two-turns.md'))
  assert({
    given: 'a chat with no log comments',
    should: 'reconstruct the conversation alone',
    actual: state.conversation.length,
    expected: 2,
  })
  assert({
    given: 'a chat with no log comments',
    should: 'report no recorded context state',
    actual: { universePaths: state.universePaths, queries: state.queries, lastTurn: state.lastTurn },
    expected: { universePaths: [], queries: [], lastTurn: 0 },
  })
})

test('reconstructResumeState - duplicate paths in a hand-edited log are deduped', () => {
  // Not writer-canonical (diff records only additions) — defensive only.
  const body = '# Dedupe Test\n\n## Jane\n\nQuestion.\n\n## AI Assistant\n\nAnswer.\n'
  const doc = ChatDocument.fromMarkdown(
    body +
      serializeContextLog([
        { turn: 1, queries: [], universe: [{ path: 'projects/Atlas/plan.md', score: 5, tokens: 100 }] },
        {
          turn: 2,
          queries: [],
          diff: [
            { path: 'projects/Atlas/plan.md', score: 5, tokens: 100 },
            { path: 'goals/2026.md', tokens: 80, pinned: true },
          ],
        },
      ]),
  )
  assert({
    given: 'a diff repeating a universe path',
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
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log-v2.md'))),
  )
  const candidate = buildCandidate(
    [
      ...original.conversation,
      { role: 'user', content: 'One more question.' },
      { role: 'assistant', content: 'One more answer.' },
    ],
    [...original.contextLog, { turn: 3, queries: [] }],
  )
  assert({
    given: 'the original conversation plus a new exchange and log entry',
    should: 'pass the gate',
    actual: verifyResumeCandidate(candidate, original),
    expected: { ok: true },
  })
})

test('verifyResumeCandidate - accepts stamped new turns after an unstamped original', async () => {
  const original = reconstructResumeState(
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log-v2.md'))),
  )
  const candidate = buildCandidate(
    [
      ...original.conversation,
      { role: 'user', content: 'One more question.', when: '2026-08-15 14:32' },
      { role: 'assistant', content: 'One more answer.', when: '2026-08-15 14:33' },
    ],
    [...original.contextLog, { turn: 3, queries: [] }],
  )
  assert({
    given: 'a pre-stamp original continued with stamped headings',
    should: 'pass the gate — old headings stay bare, stamps live on new turns only',
    actual: verifyResumeCandidate(candidate, original),
    expected: { ok: true },
  })
})

test('verifyResumeCandidate - rejects a mutated original message', async () => {
  const original = reconstructResumeState(
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log-v2.md'))),
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
    ChatDocument.fromMarkdown(await readTextFile(path.join(FIXTURES_DIR, 'two-turns-with-context-log-v2.md'))),
  )
  const candidate = buildCandidate(original.conversation, original.contextLog.slice(0, 1))
  assert({
    given: 'a candidate that dropped a carried log entry',
    should: 'refuse the write',
    actual: verifyResumeCandidate(candidate, original),
    expected: { ok: false, reason: 'context log shrank: 1 < 2 entries' },
  })
})

test('verifyResumeCandidate - allows the trailing-user merge of an interrupted chat', () => {
  const original = reconstructResumeState(ChatDocument.fromMarkdown('# Interrupted\n\n## Jane\n\nOnly question.'))
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
})
