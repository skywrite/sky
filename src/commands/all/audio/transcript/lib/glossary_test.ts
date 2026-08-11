import { assert, test } from '#test'
import { applyRulings, buildRulings, emptyGlossary, parseGlossary, renderGlossary } from './glossary.ts'
import type { Glossary } from './glossary.ts'

test('parseGlossary()', () => {
  const valid: Glossary = {
    version: 1,
    entries: [
      {
        wrong: 'Novack',
        right: 'Novak',
        action: 'correct',
        count: 2,
        firstSeen: '2026-07-01',
        lastSeen: '2026-07-20',
      },
      { wrong: 'Atlas', action: 'keep', count: 1, firstSeen: '2026-07-10', lastSeen: '2026-07-10' },
    ],
  }
  assert({
    given: 'a well-formed glossary file',
    should: 'round-trip all entries',
    actual: parseGlossary(JSON.stringify(valid)),
    expected: valid,
  })

  assert({
    given: 'malformed JSON (a bad hand-edit)',
    should: 'return null so the file is never overwritten',
    actual: parseGlossary('{ entries: ['),
    expected: null,
  })

  assert({
    given: 'JSON without an entries array',
    should: 'return null',
    actual: parseGlossary('{"version":1}'),
    expected: null,
  })

  assert({
    given: 'entries missing required fields',
    should: 'drop just those entries',
    actual: parseGlossary(
      JSON.stringify({
        entries: [
          { wrong: 'Novack', right: 'Novak', action: 'correct', count: 1, firstSeen: 'x', lastSeen: 'x' },
          { wrong: '', right: 'Novak', action: 'correct', count: 1, firstSeen: 'x', lastSeen: 'x' },
          { wrong: 'NoRight', action: 'correct', count: 1, firstSeen: 'x', lastSeen: 'x' },
          { wrong: 'BadAction', action: 'flag', count: 1, firstSeen: 'x', lastSeen: 'x' },
        ],
      }),
    )?.entries.map((e) => e.wrong),
    expected: ['Novack'],
  })
})

test('buildRulings()', () => {
  const issues = [
    { type: 'name', originalText: 'Niles Novack' },
    { type: 'technical', originalText: 'sky oss' },
    { type: 'unclear', originalText: 'banks' },
    { type: 'inaudible', originalText: '[inaudible]' },
    { type: 'filler', originalText: 'um' },
    { type: 'name', originalText: 'Jane Doh' },
  ]
  assert({
    given: 'review decisions across issue types',
    should: 'record only durable types, mapping skips and same-text customs to keep',
    actual: buildRulings(issues, [
      { issueIndex: 0, correction: 'Nils Novak', action: 'accept' },
      { issueIndex: 1, correction: 'Sky OSS', action: 'custom' },
      { issueIndex: 2, correction: '', action: 'skip' },
      { issueIndex: 3, correction: 'the budget', action: 'custom' }, // inaudible never generalizes
      { issueIndex: 4, correction: '', action: 'accept' }, // filler never generalizes
      { issueIndex: 5, correction: 'Jane  Doh', action: 'custom' }, // same text, spacing aside → keep
    ]),
    expected: [
      { wrong: 'Niles Novack', right: 'Nils Novak' },
      { wrong: 'sky oss', right: 'Sky OSS' },
      { wrong: 'banks', right: null },
      { wrong: 'Jane Doh', right: null },
    ],
  })

  assert({
    given: 'an empty correction on accept and an out-of-range index',
    should: 'drop both',
    actual: buildRulings(issues, [
      { issueIndex: 0, correction: '  ', action: 'accept' },
      { issueIndex: 99, correction: 'x', action: 'accept' },
    ]),
    expected: [],
  })

  assert({
    given: 'sentence-shaped spans on durable types',
    should: 'drop them — only term-shaped text generalizes',
    actual: buildRulings(
      [
        { type: 'unclear', originalText: 'we should have shipped the fix' }, // > 3 words
        { type: 'unclear', originalText: 'plans for atlas launch' }, // 4 clean words still isn't a term
        { type: 'name', originalText: 'talked about Atlas, briefly' }, // comma
        { type: 'unclear', originalText: 'the demo went fine.' }, // sentence period
      ],
      [
        { issueIndex: 0, correction: 'we should have shipped a fix', action: 'custom' },
        { issueIndex: 1, correction: 'plans for the atlas launch', action: 'custom' },
        { issueIndex: 2, correction: 'talked about Atlantis, briefly', action: 'custom' },
        { issueIndex: 3, correction: 'the demo went fine, mostly.', action: 'custom' },
      ],
    ),
    expected: [],
  })

  assert({
    given: 'a term with an internal period',
    should: 'stay recordable — only clause punctuation marks a sentence',
    actual: buildRulings(
      [{ type: 'technical', originalText: 'node.js' }],
      [{ issueIndex: 0, correction: 'Node.js', action: 'custom' }],
    ),
    expected: [{ wrong: 'node.js', right: 'Node.js' }],
  })

  assert({
    given: 'corrections that only trim words off an edge',
    should: 'drop them (caption-bleed artifacts), while keeping character-level trims like plural fixes',
    actual: buildRulings(
      [
        { type: 'unclear', originalText: 'merging this Thanks' },
        { type: 'unclear', originalText: 'Okay merging this' },
        { type: 'name', originalText: 'Novaks' },
      ],
      [
        { issueIndex: 0, correction: 'merging this', action: 'custom' },
        { issueIndex: 1, correction: 'merging this', action: 'custom' },
        { issueIndex: 2, correction: 'Novak', action: 'custom' },
      ],
    ),
    expected: [{ wrong: 'Novaks', right: 'Novak' }],
  })

  assert({
    given: 'corrections where neither side names anything',
    should: 'drop them — a standing rule for ordinary English misfires on its legitimate uses',
    actual: buildRulings(
      [
        { type: 'unclear', originalText: 'Her plan changed' }, // capital only for starting the sentence
        { type: 'unclear', originalText: 'worked' },
        { type: 'unclear', originalText: '$4.99' },
        { type: 'unclear', originalText: 'at less' }, // survives via the entity on the right side
      ],
      [
        { issueIndex: 0, correction: 'their plan changed', action: 'custom' },
        { issueIndex: 1, correction: 'works', action: 'custom' },
        { issueIndex: 2, correction: '499', action: 'custom' },
        { issueIndex: 3, correction: 'Atlas', action: 'custom' },
      ],
    ),
    expected: [{ wrong: 'at less', right: 'Atlas' }],
  })
})

test('applyRulings()', () => {
  const glossary = emptyGlossary()
  applyRulings(glossary, [{ wrong: 'Novack', right: 'Novak' }], '2026-07-01')
  applyRulings(glossary, [{ wrong: 'novack', right: 'Novak' }], '2026-07-15')
  assert({
    given: 'the same term ruled twice (case differing)',
    should: 'bump one entry, keeping firstSeen and advancing lastSeen',
    actual: glossary.entries,
    expected: [
      {
        wrong: 'Novack',
        right: 'Novak',
        action: 'correct',
        count: 2,
        firstSeen: '2026-07-01',
        lastSeen: '2026-07-15',
      },
    ],
  })

  applyRulings(glossary, [{ wrong: 'Novack', right: null }], '2026-07-20')
  assert({
    given: 'a later keep ruling on a corrected term',
    should: 'flip the entry to keep and drop the replacement (latest wins)',
    actual: glossary.entries,
    expected: [{ wrong: 'Novack', action: 'keep', count: 3, firstSeen: '2026-07-01', lastSeen: '2026-07-20' }],
  })

  applyRulings(glossary, [{ wrong: 'Novack', right: 'Klüver' }], '2026-07-21')
  assert({
    given: 'a later correct ruling on a kept term',
    should: 'flip back to correct with the new spelling',
    actual: glossary.entries[0],
    expected: {
      wrong: 'Novack',
      right: 'Klüver',
      action: 'correct',
      count: 4,
      firstSeen: '2026-07-01',
      lastSeen: '2026-07-21',
    },
  })
})

test('renderGlossary()', () => {
  assert({
    given: 'an empty glossary',
    should: 'render a placeholder so the prompt stays well-formed',
    actual: renderGlossary(emptyGlossary()),
    expected: '(none yet)',
  })

  const glossary: Glossary = {
    version: 1,
    entries: [
      {
        wrong: 'Novack',
        right: 'Novak',
        action: 'correct',
        count: 3,
        firstSeen: '2026-07-01',
        lastSeen: '2026-07-20',
      },
      {
        wrong: 'at less',
        right: 'Atlas',
        action: 'correct',
        count: 1,
        firstSeen: '2026-07-10',
        lastSeen: '2026-07-10',
      },
      { wrong: 'Atlas', action: 'keep', count: 1, firstSeen: '2026-07-10', lastSeen: '2026-07-10' },
    ],
  }
  assert({
    given: 'name-shaped corrections, ordinary-English corrections, and keeps',
    should: 'tier them: confirmed replacements, sounds-like hints, leave as-is',
    actual: renderGlossary(glossary),
    expected: [
      'Confirmed corrections (apply at HIGH confidence, do not ask):',
      '- "Novack" → "Novak" (confirmed 3×, last 2026-07-20)',
      '',
      'Sounds-like hints (correct only where context clearly means the entity; otherwise ask, suggesting this fix):',
      '- "at less" → "Atlas" (confirmed 1×, last 2026-07-10)',
      '',
      'Leave as-is (do not flag):',
      '- "Atlas"',
    ].join('\n'),
  })

  const legacyFragment: Glossary = {
    version: 1,
    entries: [
      {
        wrong: 'Her plan changed',
        right: 'Their plan changed',
        action: 'correct',
        count: 1,
        firstSeen: '2026-07-01',
        lastSeen: '2026-07-01',
      },
      {
        wrong: 'Jane Doh',
        right: 'Jane Doe',
        action: 'correct',
        count: 1,
        firstSeen: '2026-07-01',
        lastSeen: '2026-07-01',
      },
    ],
  }
  assert({
    given: 'a stored fragment whose only capital starts the sentence, next to a real name',
    should: 'demote the fragment to a context-judged hint while the name stays confirmed',
    actual: renderGlossary(legacyFragment)
      .split('\n\n')
      .map((section) => section.split('\n')[0]?.split(' (')[0] + ' :: ' + section.split('\n')[1]),
    expected: [
      'Confirmed corrections :: - "Jane Doh" → "Jane Doe" (confirmed 1×, last 2026-07-01)',
      'Sounds-like hints :: - "Her plan changed" → "Their plan changed" (confirmed 1×, last 2026-07-01)',
    ],
  })
})
