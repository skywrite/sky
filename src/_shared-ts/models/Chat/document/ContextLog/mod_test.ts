import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { type ContextTurnLog, serializeContextLog, splitContextLog } from './mod.ts'

// Log-format fixtures live with the module; chat-transcript fixtures that
// document-level tests share stay one directory up.
const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')
const DOC_FIXTURES_DIR = path.join(import.meta.dirname!, '..', 'fixtures')

async function readFixture(name: string, dir = FIXTURES_DIR): Promise<string> {
  return await readTextFile(path.join(dir, name))
}

// Each v2 fixture is a complete fake saved chat generated through the real
// serializer, byte-for-byte what the ai:chat writer produces. Every test
// asserts two things against the TS-side expected entries:
//   1. the parsed entries match — parsing is anchored to independent ground truth
//   2. body + serializeContextLog(entries) === raw — the round-trip law

interface LogFixture {
  file: string
  description: string
  expected: ContextTurnLog[]
  /** Set for chat-transcript fixtures shared with document-level tests */
  docLevel?: true
}

const logFixtures: LogFixture[] = [
  {
    file: 'context-log-v2.md',
    description: 'two turns covering universe, diff, pruned, tools, and errors',
    expected: [
      {
        turn: 1,
        queries: ['{ projects(where: { nameContains: "Atlas" }) { path } }'],
        stats: { kept: 3, pruned: 1, excluded: 0, docTokens: 5200 },
        universe: [
          { path: 'goals/2026.md', tokens: 800, pinned: true },
          { path: 'projects/Atlas/launch-plan.md', score: 9.5, tokens: 2600 },
          {
            path: 'time/2026/05/25-31/05-28/actions/notes/Atlas-Beta-Findings.md',
            score: 2.1,
            tokens: 3100,
            cut: 'budget',
          },
          { path: 'time/2026/06/01-07/06-02/journal/08_focus_Planning-The-Atlas-Beta.md', score: 6.5, tokens: 1800 },
        ],
      },
      {
        turn: 2,
        queries: [
          '{ projects(where: { nameContains: "Atlas" }) { path } }',
          '{ people(where: { nameContains: "Jane Doe" }) { path } }',
        ],
        stats: { kept: 4, pruned: 1, excluded: 0, docTokens: 6100 },
        diff: [{ path: 'people/2020/ja/Jane-Doe.md', score: 8.2, tokens: 900 }],
        pruned: [
          {
            path: 'time/2026/05/25-31/05-28/actions/notes/Atlas-Beta-Findings.md',
            score: 2.1,
            tokens: 3100,
            cut: 'budget',
          },
        ],
        tools: [
          { tool: 'web_fetch', input: 'https://example.com/atlas-pricing', outcome: 'ok', tokens: 1450 },
          { tool: 'web_search', input: 'Atlas beta launch checklist', outcome: 'denied' },
        ],
        errors: ['markdown:sel failed: expected token --> got EOF'],
      },
    ],
  },
  {
    file: 'context-log-v2-s3.md',
    description: 'an s3-era log with score parts, floor cuts, and scoring params in stats',
    expected: [
      {
        turn: 1,
        queries: ['{ people(where: { nameContains: "Jane Doe" }) { path } }'],
        stats: {
          kept: 2,
          pruned: 0,
          excluded: 0,
          docTokens: 1200,
          budget: 300000,
          scoring: 's3',
          floor: 8.4,
          floored: 2,
        },
        universe: [
          { path: 'goals/2026.md', tokens: 300, pinned: true },
          { path: 'people/Jane-Doe.md', score: 24, tokens: 900, lex: 8, prov: 'targeted' },
          { path: 'time/2026/01/26-01/01-27/day.md', score: 8, tokens: 400, cut: 'floor' },
          {
            path: 'time/2026/01/26-01/01-27/actions/messages/slack_Atlas-Bot-to-atlas-general_Weekly-Digest.md',
            score: 7.9,
            tokens: 1100,
            lex: 1.9,
            cut: 'floor',
          },
        ],
      },
      {
        turn: 2,
        queries: [
          '{ people(where: { nameContains: "Jane Doe" }) { path } }',
          '{ projects(where: { nameContains: "Atlas" }) { path } }',
        ],
        stats: {
          kept: 3,
          pruned: 0,
          excluded: 0,
          docTokens: 2400,
          budget: 300000,
          scoring: 's3',
          floor: 8.4,
          floored: 2,
        },
        diff: [{ path: 'projects/Atlas/Roadmap.md', score: 18.5, tokens: 1200, lex: 6.2, prov: 'targeted' }],
        pruned: [
          { path: 'time/2026/01/26-01/01-27/day.md', score: 8, tokens: 400, cut: 'floor' },
          {
            path: 'time/2026/01/26-01/01-27/actions/messages/slack_Atlas-Bot-to-atlas-general_Weekly-Digest.md',
            score: 7.9,
            tokens: 1100,
            lex: 1.9,
            cut: 'floor',
          },
        ],
      },
    ],
  },
  {
    file: 'context-log-v2-quoted-marker.md',
    description: 'a quoted CONTEXT-LOG marker mid-body before the real log',
    expected: [
      {
        turn: 1,
        queries: ['{ chats(where: { summaryContains: "log format" }) { path } }'],
        stats: { kept: 1, pruned: 0, excluded: 0, docTokens: 400 },
        universe: [{ path: 'projects/Atlas/notes.md', score: 4.2, tokens: 400 }],
      },
    ],
  },
  {
    file: 'two-turns-with-context-log-v2.md',
    docLevel: true,
    description: 'a two-exchange transcript with a v2 log',
    expected: [
      {
        turn: 1,
        queries: ['{ documents(where: { bodyContains: "Atlas" }) { path } }'],
        stats: { kept: 3, pruned: 1, excluded: 0, docTokens: 2600 },
        universe: [
          { path: 'goals/2026.md', tokens: 300, pinned: true },
          { path: 'projects/Atlas/plan.md', score: 7.5, tokens: 1400 },
          { path: 'time/2026/03/02-08/03-01/actions/notes/Old-Notes.md', score: 3, tokens: 1200, cut: 'budget' },
          { path: 'time/2026/03/02-08/03-05/journal/09_planning_Atlas-Launch-Week.md', score: 6.1, tokens: 900 },
        ],
      },
      {
        turn: 2,
        queries: [
          '{ documents(where: { bodyContains: "Atlas" }) { path } }',
          '{ decisions(where: { pending: true }) { path } }',
        ],
        stats: { kept: 4, pruned: 1, excluded: 0, docTokens: 3000 },
        diff: [{ path: 'decisions/pricing-tier.md', score: 9, tokens: 400 }],
        pruned: [
          { path: 'time/2026/03/02-08/03-01/actions/notes/Old-Notes.md', score: 3, tokens: 1200, cut: 'budget' },
        ],
        errors: ['ai:context:evolve failed: fetch timeout'],
      },
    ],
  },
]

logFixtures.forEach((fixture) => {
  test(`contextLog - ${fixture.description}`, async () => {
    const raw = await readFixture(fixture.file, fixture.docLevel ? DOC_FIXTURES_DIR : FIXTURES_DIR)
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

test('splitContextLog - tolerates a normalizer-collapsed final newline', async () => {
  const raw = await readFixture('context-log-v2.md')
  const trimmed = raw.replace(/\n+$/, '')
  assert({
    given: 'a v2 file whose final newline was collapsed on disk',
    should: 'parse the same entries',
    actual: splitContextLog(trimmed).entries,
    expected: splitContextLog(raw).entries,
  })
})

test('splitContextLog - keeps the quoted marker in the body', async () => {
  const { body } = splitContextLog(await readFixture('context-log-v2-quoted-marker.md'))
  assert({
    given: 'conversation text quoting the CONTEXT-LOG marker at a line start',
    should: 'leave the quote in the body',
    actual: body.includes('<!-- CONTEXT-LOG'),
    expected: true,
  })
  assert({
    given: 'conversation text quoting the CONTEXT-LOG marker',
    should: 'still strip the real trailing log',
    actual: body.includes('"version": 2'),
    expected: false,
  })
})

test('serializeContextLog - escapes --> so it cannot terminate the comment', () => {
  const entries: ContextTurnLog[] = [{ turn: 1, queries: ['{ chats { path } } # see --> arrow'] }]
  const serialized = serializeContextLog(entries)
  assert({
    given: 'a query string containing -->',
    should: 'leave exactly one --> in the output: the comment terminator',
    actual: serialized.indexOf('-->') === serialized.lastIndexOf('-->'),
    expected: true,
  })
  assert({
    given: 'the escaped serialization',
    should: 'restore the original string on parse',
    actual: splitContextLog('# T\n\nBody.\n' + serialized).entries,
    expected: entries,
  })
})

test('contextLog - score-part fields round-trip within v2', () => {
  // lex/prov are additive v2 fields — records carrying them and records
  // without them coexist in one log, and neither direction loses data.
  const entries: ContextTurnLog[] = [
    {
      turn: 1,
      queries: ['{ people(where: { nameContains: "Jane" }) { path } }'],
      stats: {
        kept: 1,
        pruned: 0,
        excluded: 0,
        docTokens: 900,
        budget: 300000,
        scoring: 's3',
        floor: 7.46,
        floored: 1,
      },
      universe: [
        { path: 'people/Jane-Doe.md', score: 21.3, tokens: 900, lex: 5.3, prov: 'targeted' },
        { path: 'time/2026/03/02-08/03-05/day.md', score: 7.9, tokens: 1200, cut: 'floor' },
      ],
    },
    {
      turn: 2,
      queries: [],
      pruned: [{ path: 'projects/Atlas/plan.md', score: 4.4, tokens: 2100, lex: 0.8, prov: 'broad', cut: 'budget' }],
    },
  ]
  const serialized = serializeContextLog(entries)
  assert({
    given: 'records carrying the Stage 2 lex/prov score parts',
    should: 'round-trip through serialize and parse unchanged',
    actual: splitContextLog('# T\n\nBody.\n' + serialized).entries,
    expected: entries,
  })
})

test('splitContextLog - an unreadable CONTEXT-LOG block stays inert in the body', () => {
  const broken = '# T\n\nBody.\n\n\n<!-- CONTEXT-LOG\n{ broken json\n-->\n'
  const { body, entries } = splitContextLog(broken)
  assert({
    given: 'a CONTEXT-LOG block with invalid JSON',
    should: 'report no entries',
    actual: entries,
    expected: [],
  })
  assert({
    given: 'a CONTEXT-LOG block with invalid JSON',
    should: 'leave the whole document as body',
    actual: body,
    expected: broken,
  })
})

test('splitContextLog - a future version is detected, not parsed', () => {
  const future = '# T\n\nBody.\n\n\n<!-- CONTEXT-LOG\n{ "version": 3, "turns": [] }\n-->\n'
  const { body, entries } = splitContextLog(future)
  assert({
    given: 'a CONTEXT-LOG block from a future version',
    should: 'report no entries',
    actual: entries,
    expected: [],
  })
  assert({
    given: 'a CONTEXT-LOG block from a future version',
    should: 'leave the block inert in the body',
    actual: body,
    expected: future,
  })
})

// --- legacy `<!-- TURN` format: recognized structurally, never parsed ---

const legacyFixtures: Array<{ file: string; docLevel?: true }> = [
  { file: 'context-log-full.md' },
  { file: 'context-log-with-stats.md' },
  { file: 'two-turns-with-context-log.md', docLevel: true },
]

legacyFixtures.forEach(({ file, docLevel }) => {
  test(`contextLog - legacy ${file} splits off cleanly and parses to nothing`, async () => {
    const { body, entries } = splitContextLog(await readFixture(file, docLevel ? DOC_FIXTURES_DIR : FIXTURES_DIR))
    assert({
      given: 'a legacy TURN-format transcript',
      should: 'report no entries',
      actual: entries,
      expected: [],
    })
    assert({
      given: 'a legacy TURN-format transcript',
      should: 'keep the conversation body free of log debris',
      actual: body.includes('<!-- TURN'),
      expected: false,
    })
  })
})

test('splitContextLog - a quoted TURN comment stays in the body of a legacy file', async () => {
  const { body } = splitContextLog(await readFixture('context-log-quoted-turn-in-body.md'))
  assert({
    given: 'legacy conversation text quoting the TURN format',
    should: 'leave the quoted comment untouched in the body',
    actual: body.includes('<!-- TURN 9'),
    expected: true,
  })
  assert({
    given: 'legacy conversation text quoting the TURN format',
    should: 'strip the real trailing log from the body',
    actual: body.includes('<!-- TURN 1'),
    expected: false,
  })
})

test('splitContextLog - document without a log is returned unchanged', async () => {
  const raw = await readFixture('simple-two-turns.md', DOC_FIXTURES_DIR)
  const { body, entries } = splitContextLog(raw)
  assert({
    given: 'a chat with no log comments',
    should: 'return the body untouched',
    actual: body,
    expected: raw,
  })
  assert({
    given: 'a chat with no log comments',
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

test('serializeContextLog - a memory entry round-trips', () => {
  const entries: ContextTurnLog[] = [
    { turn: 1, queries: [] },
    {
      turn: 1,
      queries: [],
      memory: [
        { op: 'create', slug: 'big-deck', kind: 'glossary', summary: 'The big deck', outcome: 'applied' },
        { op: 'confirm', slug: 'missing', summary: 'missing', outcome: 'skipped', reason: 'no such memory' },
      ],
    },
  ]
  const serialized = serializeContextLog(entries)
  const { body, entries: parsed } = splitContextLog(`Chat body.\n${serialized}`)
  assert({
    given: 'a final entry carrying memory op outcomes',
    should: 'serialize one record per line and parse back intact',
    actual: { body, parsed, oneLine: serialized.includes('{"op":"create","slug":"big-deck"') },
    expected: { body: 'Chat body.\n', parsed: entries, oneLine: true },
  })
})
