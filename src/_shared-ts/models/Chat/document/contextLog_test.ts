import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { type ContextTurnLog, serializeContextLog, splitContextLog } from './contextLog.ts'

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')

async function readFixture(name: string): Promise<string> {
  return await readTextFile(path.join(FIXTURES_DIR, name))
}

// Each fixture is a complete fake saved chat, byte-for-byte in the format the
// ai:chat writer produces. splitContextLog runs on the raw file text (the
// frontmatter is just body to it). Every test asserts two things against the
// TS-side expected entries:
//   1. the parsed entries match — parsing is anchored to independent ground truth
//   2. body + serializeContextLog(entries) === raw — the round-trip law, which
//      pins the serializer to the exact legacy bytes checked into the fixture

interface LogFixture {
  file: string
  description: string
  expected: ContextTurnLog[]
}

const logFixtures: LogFixture[] = [
  {
    file: 'context-log-full.md',
    description: 'every section type across three turns',
    expected: [
      {
        turn: 1,
        queries: ['{ documents(where: { bodyContains: "Atlas" }) { path } }'],
        context: ['goals/2026.md', 'projects/Atlas/beta-feedback.md', 'time/2026/03-March/12/journal/entry.md'],
        pruned: ['time/2026/03-March/08/notes.md (score=3, ~1400 tokens)'],
      },
      {
        turn: 2,
        queries: [
          '{ documents(where: { bodyContains: "Atlas" }) { path } }',
          '{ decisions(where: { pending: true }) { path } }',
        ],
        diff: ['decisions/pricing-tier.md'],
        pruned: [],
        excluded: ['time/2026/02-February/20/notes.md (superseded by summary, ~900 tokens)'],
        errors: ['Context query failed'],
      },
      { turn: 3, queries: [], pruned: [] },
    ],
  },
  {
    file: 'context-log-empty-context.md',
    description: 'turn 1 with a bare CONTEXT header (nothing gathered)',
    expected: [
      {
        turn: 1,
        queries: ['{ documents(where: { bodyContains: "kickoff" }) { path } }'],
        context: [],
        pruned: [],
      },
    ],
  },
  {
    file: 'context-log-multiline-items.md',
    description: 'multi-line query and multi-line error',
    expected: [
      {
        turn: 1,
        queries: ['{\n  projects(where: { nameContains: "Atlas" }) {\n    path\n  }\n}'],
        context: ['projects/Atlas/plan.md'],
        pruned: [],
        errors: ['request failed:\nconnection reset by peer'],
      },
    ],
  },
  {
    file: 'context-log-quoted-turn-in-body.md',
    description: 'a quoted TURN comment mid-body before the real log',
    expected: [
      {
        turn: 1,
        queries: ['{ chats(where: { summaryContains: "logging" }) { path } }'],
        context: ['time/2026/05-May/01/actions/ai-chats/10-15_Example.md'],
        pruned: [],
      },
    ],
  },
]

logFixtures.forEach((fixture) => {
  test(`contextLog - ${fixture.description}`, async () => {
    const raw = await readFixture(fixture.file)
    const { body, entries } = splitContextLog(raw)

    assert({
      given: fixture.description,
      should: 'parse the expected entries',
      actual: entries,
      expected: fixture.expected,
    })

    assert({
      given: fixture.description,
      should: 'satisfy the round-trip law: body + serialize(entries) === raw',
      actual: body + serializeContextLog(entries),
      expected: raw,
    })
  })
})

test('splitContextLog - keeps a quoted TURN comment in the body', async () => {
  const { body } = splitContextLog(await readFixture('context-log-quoted-turn-in-body.md'))
  assert({
    given: 'conversation text quoting the TURN format',
    should: 'leave the quoted comment untouched in the body',
    actual: body.includes('<!-- TURN 9'),
    expected: true,
  })
  assert({
    given: 'conversation text quoting the TURN format',
    should: 'strip the real trailing log from the body',
    actual: body.includes('<!-- TURN 1'),
    expected: false,
  })
})

test('splitContextLog - document without a log is returned unchanged', async () => {
  const raw = await readFixture('simple-two-turns.md')
  const { body, entries } = splitContextLog(raw)
  assert({
    given: 'a chat with no TURN comments',
    should: 'return the body untouched',
    actual: body,
    expected: raw,
  })
  assert({
    given: 'a chat with no TURN comments',
    should: 'return no entries',
    actual: entries,
    expected: [],
  })
})

test('serializeContextLog - empty input serializes to empty string', () => {
  assert({
    given: 'no entries',
    should: 'produce no trailing log at all',
    actual: serializeContextLog([]),
    expected: '',
  })
})
