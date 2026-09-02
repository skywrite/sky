import type { ContextTurnLog } from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import { assert, test } from '#test'
import { timelineOf } from './timeline.ts'

const TURNS: ConversationMessage[] = [
  { role: 'user', content: 'one', when: '2026-01-27 09:12' },
  { role: 'assistant', content: 'a' },
  { role: 'user', content: 'two', when: '2026-01-27 09:14' },
  { role: 'assistant', content: 'b' },
  { role: 'user', content: 'three' },
  { role: 'assistant', content: 'c' },
  { role: 'user', content: 'four', when: '2026-01-27 09:19' },
]

const LOG: ContextTurnLog[] = [
  {
    turn: 1,
    queries: ['{ q1 }'],
    stats: { kept: 3, pruned: 1, excluded: 0, docTokens: 90, budget: 100 },
    universe: [
      { path: 'time/day.md', tokens: 30, score: 9 },
      { path: 'goals/2026.md', tokens: 20, pinned: true },
      { path: 'projects/Atlas/Roadmap.md', tokens: 40, score: 7 },
      { path: 'projects/Atlas/Old.md', tokens: 50, score: 2, cut: 'budget' },
    ],
  },
  {
    turn: 2,
    queries: ['{ q1 }', '{ q2 }'],
    stats: { kept: 3, pruned: 2, excluded: 1, docTokens: 95, budget: 100 },
    diff: [
      { path: 'people/jane-doe.md', tokens: 25, score: 8 },
      { path: 'notes/big.md', tokens: 90, score: 3, cut: 'budget' },
    ],
    pruned: [
      { path: 'projects/Atlas/Old.md', tokens: 50, score: 2, cut: 'budget' },
      { path: 'notes/big.md', tokens: 90, score: 3, cut: 'budget' },
      { path: 'projects/Atlas/Roadmap.md', tokens: 40, score: 7, cut: 'budget' },
      { path: 'time/day.md', tokens: 30, cut: 'excluded by you' },
    ],
    tools: [{ tool: 'read_file', input: 'notes/atlas/checklist.md', outcome: 'ok', tokens: 300 }],
  },
  {
    turn: 3,
    queries: ['{ q1 }', '{ q2 }'],
    stats: { kept: 3, pruned: 2, excluded: 1, docTokens: 95, budget: 100, reused: true },
  },
  {
    turn: 4,
    queries: ['{ q3 }'],
    errors: ['ai:context:evolve failed'],
  },
]

test({ name: 'timeline - the seed turn counts what was found and pushes nothing out' }, () => {
  const [seed] = timelineOf(LOG, TURNS)
  assert({
    given: 'the first entry, with its universe',
    should: 'be the seed: found = the universe, stamped by the first message, nothing added or pushed out',
    actual: {
      kind: seed.kind,
      found: seed.found,
      when: seed.when,
      searches: seed.searches,
      added: seed.added.length,
      pushedOut: seed.pushedOut.length,
    },
    expected: { kind: 'seed', found: 4, when: '09:12', searches: 1, added: 0, pushedOut: 0 },
  })
})

test({ name: 'timeline - a grown turn lists what came in and what the budget pushed out' }, () => {
  const [, grew] = timelineOf(LOG, TURNS)
  assert({
    given: 'a turn whose queries brought two documents and whose budget cut a third',
    should: 'list the two as added — the one that never fit included — and only the previously kept one as pushed out',
    actual: {
      kind: grew.kind,
      when: grew.when,
      searches: grew.searches,
      added: grew.added.map((r) => r.path),
      pushedOut: grew.pushedOut.map((r) => r.path),
      tools: grew.tools.map((t) => t.tool),
    },
    expected: {
      kind: 'grew',
      when: '09:14',
      searches: 1,
      added: ['people/jane-doe.md', 'notes/big.md'],
      pushedOut: ['projects/Atlas/Roadmap.md'],
      tools: ['read_file'],
    },
  })
})

test({ name: 'timeline - a quiet turn reuses; a broken turn fails; unstamped messages have no time' }, () => {
  const [, , same, failed] = timelineOf(LOG, TURNS)
  assert({
    given: 'a reused entry and an errors-only entry',
    should: 'read as same and failed, with the errors carried and the missing stamp null',
    actual: {
      same: { kind: same.kind, when: same.when, searches: same.searches, pushedOut: same.pushedOut.length },
      failed: { kind: failed.kind, when: failed.when, searches: failed.searches, errors: failed.errors },
    },
    expected: {
      same: { kind: 'same', when: null, searches: 0, pushedOut: 0 },
      failed: { kind: 'failed', when: '09:19', searches: 1, errors: ['ai:context:evolve failed'] },
    },
  })
})

test({ name: 'timeline - a cut carried through a quiet turn is not pushed out again' }, () => {
  const log: ContextTurnLog[] = [
    ...LOG.slice(0, 3),
    {
      turn: 4,
      queries: ['{ q1 }', '{ q2 }', '{ q3 }'],
      stats: { kept: 3, pruned: 2, excluded: 1, docTokens: 95, budget: 100 },
      pruned: [
        { path: 'projects/Atlas/Old.md', tokens: 50, score: 2, cut: 'budget' },
        { path: 'projects/Atlas/Roadmap.md', tokens: 40, score: 7, cut: 'budget' },
      ],
    },
  ]
  const [, , , again] = timelineOf(log, TURNS)
  assert({
    given: 'a rebuild after a quiet turn, cutting the same documents as before',
    should: 'push nothing out — the quiet turn carried the earlier cuts forward',
    actual: { kind: again.kind, pushedOut: again.pushedOut.length, searches: again.searches },
    expected: { kind: 'grew', pushedOut: 0, searches: 1 },
  })
})
