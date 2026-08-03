import { assert, test } from '#test'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import {
  buildTagVocabulary,
  type EntityContext,
  formatEntityContext,
  formatPeopleBlock,
  formatTagVocabulary,
  mergeScoredPeople,
  type PersonEntity,
  type TagVocabulary,
} from './_entityContext.ts'

const NO_TAGS: TagVocabulary = { active: [], branches: [], unlisted: 0 }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOB_MARKDOWN = `---
name:
  - Bob Smith
  - Bob
title: CFO
org: Acme
---

# Bob Smith
`

const JANE_MARKDOWN = `---
name: Jane Doe
org: Initech
---

# Jane Doe
`

async function buildStore(): Promise<PeopleStore> {
  const store = await PeopleStore.build([])
  store.set('/people/bo/Bob-Smith.md', BOB_MARKDOWN)
  store.set('/people/ja/Jane-Doe.md', JANE_MARKDOWN)
  return store
}

// ---------------------------------------------------------------------------
// formatEntityContext
// ---------------------------------------------------------------------------

test('formatEntityContext - all sections populated', () => {
  const ctx: EntityContext = {
    people: [
      { name: 'Bob Smith', aliases: ['Bob'], title: 'CFO', org: 'Acme' },
      { name: 'Jane Doe', aliases: [] },
    ],
    projects: ['Camino-Acme-Pay', 'Website-Redesign'],
    decisions: ['Hire-CTO', 'Office-Location'],
    goals: ['Health: Run a marathon by June', 'Leadership: Ship v2 by March'],
    tags: {
      active: [
        { name: 'Acme/Product/GTM', fileCount: 12, lastSeen: '2026-01-20' },
        { name: 'Atlas/Tokens/ABC', fileCount: 3, lastSeen: null },
      ],
      branches: [{ prefix: 'Archive', tagCount: 14, fileCount: 92, lastSeen: '2025-02-11' }],
      unlisted: 7,
    },
  }
  const result = formatEntityContext(ctx)

  assert({
    given: 'all sections populated',
    should: 'contain the heading',
    actual: result.includes('## Active Notebook Entities'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Active People section',
    actual: result.includes('### Active People (by recent interaction)'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'render people with aliases, comma-separated',
    actual: result.includes('Bob Smith (aka Bob), Jane Doe'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Open Projects section',
    actual: result.includes('### Open Projects'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain project names',
    actual: result.includes('Camino-Acme-Pay, Website-Redesign'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Pending Decisions section',
    actual: result.includes('### Pending Decisions'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain decision names',
    actual: result.includes('Hire-CTO, Office-Location'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain Active Goals section',
    actual: result.includes('### Active Goals'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain goal lines as bullet points',
    actual: result.includes('- Health: Run a marathon by June'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain the annotated Tag Vocabulary section',
    actual: result.includes('### Tag Vocabulary\nMost active: Acme/Product/GTM (12 files, last 2026-01)'),
    expected: true,
  })
})

test('formatEntityContext - empty sections omitted', () => {
  const ctx: EntityContext = {
    people: [],
    projects: ['Only-Project'],
    decisions: [],
    goals: [],
    tags: { active: [{ name: 'Some/Tag', fileCount: 4, lastSeen: '2026-01-05' }], branches: [], unlisted: 0 },
  }
  const result = formatEntityContext(ctx)

  assert({
    given: 'people empty',
    should: 'not contain Active People section',
    actual: result.includes('### Active People'),
    expected: false,
  })

  assert({
    given: 'decisions and goals empty',
    should: 'not contain Pending Decisions section',
    actual: result.includes('### Pending Decisions'),
    expected: false,
  })

  assert({
    given: 'decisions and goals empty',
    should: 'not contain Active Goals section',
    actual: result.includes('### Active Goals'),
    expected: false,
  })

  assert({
    given: 'projects and tags present',
    should: 'contain Open Projects section',
    actual: result.includes('### Open Projects'),
    expected: true,
  })

  assert({
    given: 'projects and tags present',
    should: 'contain Tag Vocabulary section',
    actual: result.includes('### Tag Vocabulary'),
    expected: true,
  })
})

test('formatEntityContext - all empty returns empty string', () => {
  const ctx: EntityContext = {
    people: [],
    projects: [],
    decisions: [],
    goals: [],
    tags: NO_TAGS,
  }
  const result = formatEntityContext(ctx)

  assert({
    given: 'all sections empty',
    should: 'return empty string',
    actual: result,
    expected: '',
  })
})

// ---------------------------------------------------------------------------
// mergeScoredPeople
// ---------------------------------------------------------------------------

test('mergeScoredPeople - collapses alias entries into one canonical person', async () => {
  const store = await buildStore()
  const result = mergeScoredPeople([{ name: 'Bob' }, { name: 'Bob Smith' }, { name: 'Jane Doe' }], store)

  assert({
    given: 'two score entries resolving to the same person file',
    should: 'collapse into a single entry',
    actual: result.length,
    expected: 2,
  })

  assert({
    given: 'an alias hit first by score rank',
    should: 'use the canonical name from the person file',
    actual: result[0].name,
    expected: 'Bob Smith',
  })

  assert({
    given: 'a person file with multiple names',
    should: 'list non-canonical names as aliases',
    actual: result[0].aliases,
    expected: ['Bob'],
  })

  assert({
    given: 'a person file with title and org',
    should: 'carry title through',
    actual: result[0].title,
    expected: 'CFO',
  })

  assert({
    given: 'a person file with title and org',
    should: 'carry org through',
    actual: result[0].org,
    expected: 'Acme',
  })
})

test('mergeScoredPeople - names without a person file pass through', async () => {
  const store = await buildStore()
  const result = mergeScoredPeople([{ name: 'Stranger Dan' }, { name: 'stranger dan' }], store)

  assert({
    given: 'a scored name with no person file',
    should: 'pass through as-is with no aliases',
    actual: result[0],
    expected: { name: 'Stranger Dan', aliases: [] },
  })

  assert({
    given: 'the same unknown name differing only by case',
    should: 'deduplicate via normalized name',
    actual: result.length,
    expected: 1,
  })
})

test('mergeScoredPeople - respects limit and null store', () => {
  const scored = [{ name: 'A One' }, { name: 'B Two' }, { name: 'C Three' }]
  const result = mergeScoredPeople(scored, null, 2)

  assert({
    given: 'no PeopleStore and a limit of 2',
    should: 'return the first 2 raw names in score order',
    actual: result.map((p) => p.name),
    expected: ['A One', 'B Two'],
  })
})

// ---------------------------------------------------------------------------
// formatPeopleBlock
// ---------------------------------------------------------------------------

test('formatPeopleBlock - bullets with role info', () => {
  const people: PersonEntity[] = [
    { name: 'Bob Smith', aliases: ['Bob'], title: 'CFO', org: 'Acme' },
    { name: 'Jane Doe', aliases: [], org: 'Initech' },
    { name: 'Stranger Dan', aliases: [] },
  ]
  const result = formatPeopleBlock(people)

  assert({
    given: 'a person with aliases, title, and org',
    should: 'render a full bullet line',
    actual: result.includes('- Bob Smith (aka Bob) — CFO, Acme'),
    expected: true,
  })

  assert({
    given: 'a person with org only',
    should: 'render name and org',
    actual: result.includes('- Jane Doe — Initech'),
    expected: true,
  })

  assert({
    given: 'a person with no title or org',
    should: 'render name without dangling separator',
    actual: result.includes('- Stranger Dan\n') || result.endsWith('- Stranger Dan'),
    expected: true,
  })
})

test('formatPeopleBlock - empty returns empty string', () => {
  assert({
    given: 'no people',
    should: 'return empty string',
    actual: formatPeopleBlock([]),
    expected: '',
  })
})

// ---------------------------------------------------------------------------
// buildTagVocabulary
// ---------------------------------------------------------------------------

/** Tight thresholds so tests stay small: 2 active, split branches over 2 tags, list lone tags at 3+ files. */
const TEST_OPTS = { limit: 2, splitAt: 2, minLoneFiles: 3 }

test('buildTagVocabulary - actives picked by score, listed alphabetically without it', () => {
  const rows = [
    { name: 'Work/Cloud', score: 9, lastSeen: '2026-01-27', fileCount: 40 },
    { name: 'Atlas/Beta', score: 5, lastSeen: null, fileCount: 12 },
    { name: 'Dormant/Theme', score: 0.2, lastSeen: '2024-06-01', fileCount: 80 },
  ]

  assert({
    given: 'three scored tags with an active limit of 2',
    should: 'keep the top two by score, alphabetical, score dropped',
    actual: buildTagVocabulary(rows, TEST_OPTS).active,
    expected: [
      { name: 'Atlas/Beta', fileCount: 12, lastSeen: null },
      { name: 'Work/Cloud', fileCount: 40, lastSeen: '2026-01-27' },
    ],
  })
})

test('buildTagVocabulary - the long tail rolls up by prefix with aggregates', () => {
  const rows = [
    { name: 'Hot/One', score: 9, lastSeen: '2026-01-27', fileCount: 4 },
    { name: 'Hot/Two', score: 8, lastSeen: '2026-01-20', fileCount: 4 },
    { name: 'Archive/Old', score: 0.4, lastSeen: '2025-02-11', fileCount: 90 },
    { name: 'Archive/Older', score: 0.2, lastSeen: '2024-06-01', fileCount: 2 },
  ]

  assert({
    given: 'two remainder tags sharing a prefix',
    should: 'aggregate tag count, file sum, and the latest lastSeen',
    actual: buildTagVocabulary(rows, TEST_OPTS).branches,
    expected: [{ prefix: 'Archive', tagCount: 2, fileCount: 92, lastSeen: '2025-02-11' }],
  })
})

test('buildTagVocabulary - oversized branches split, pooling dust as a residual', () => {
  const rows = [
    { name: 'Active/A', score: 9, lastSeen: null, fileCount: 1 },
    { name: 'Active/B', score: 8, lastSeen: null, fileCount: 1 },
    { name: 'Big/Sub/One', score: 1, lastSeen: '2025-05-01', fileCount: 5 },
    { name: 'Big/Sub/Two', score: 0.9, lastSeen: '2025-04-01', fileCount: 5 },
    { name: 'Big/Lone', score: 0.8, lastSeen: '2024-03-01', fileCount: 7 },
    { name: 'Big/Dust', score: 0.1, lastSeen: '2023-01-15', fileCount: 1 },
  ]

  assert({
    given: 'a branch of four tags with splitAt 2',
    should: 'list the multi-tag sub-branch and substantial lone tag, pool the dust after them',
    actual: buildTagVocabulary(rows, TEST_OPTS).branches,
    expected: [
      { prefix: 'Big/Lone', tagCount: 1, fileCount: 7, lastSeen: '2024-03-01' },
      { prefix: 'Big/Sub', tagCount: 2, fileCount: 10, lastSeen: '2025-05-01' },
      { prefix: 'Big', tagCount: 1, fileCount: 1, lastSeen: '2023-01-15', residual: true },
    ],
  })
})

test('buildTagVocabulary - lone tags are listed when substantial, counted when dust', () => {
  const rows = [
    { name: 'Active/A', score: 9, lastSeen: null, fileCount: 1 },
    { name: 'Active/B', score: 8, lastSeen: null, fileCount: 1 },
    { name: 'Atlas-Legacy', score: 0.5, lastSeen: '2023-05-20', fileCount: 30 },
    { name: 'one-off', score: 0.1, lastSeen: '2022-08-09', fileCount: 1 },
  ]
  const vocabulary = buildTagVocabulary(rows, TEST_OPTS)

  assert({
    given: 'a dormant 30-file lone tag and a 1-file one-off',
    should: 'list the substantial tag as itself',
    actual: vocabulary.branches,
    expected: [{ prefix: 'Atlas-Legacy', tagCount: 1, fileCount: 30, lastSeen: '2023-05-20' }],
  })

  assert({
    given: 'a dormant 30-file lone tag and a 1-file one-off',
    should: 'count the one-off as unlisted',
    actual: vocabulary.unlisted,
    expected: 1,
  })
})

test('buildTagVocabulary - does not reorder the caller’s array', () => {
  const rows = [
    { name: 'B/Low', score: 1, lastSeen: null, fileCount: 1 },
    { name: 'A/High', score: 9, lastSeen: null, fileCount: 9 },
  ]
  buildTagVocabulary(rows, TEST_OPTS)

  assert({
    given: 'a score-unsorted input array',
    should: 'leave the input untouched',
    actual: rows.map((r) => r.name),
    expected: ['B/Low', 'A/High'],
  })
})

// ---------------------------------------------------------------------------
// formatTagVocabulary
// ---------------------------------------------------------------------------

test('formatTagVocabulary - renders actives, branches, and the unlisted count', () => {
  const rendered = formatTagVocabulary({
    active: [
      { name: 'Acme/Product/GTM', fileCount: 12, lastSeen: '2026-01-20' },
      { name: 'Atlas/Tokens/ABC', fileCount: 3, lastSeen: null },
    ],
    branches: [
      { prefix: 'Archive/Deals', tagCount: 14, fileCount: 92, lastSeen: '2025-02-11' },
      { prefix: 'Archive', tagCount: 5, fileCount: 9, lastSeen: '2024-01-02', residual: true },
      { prefix: 'Atlas-Legacy', tagCount: 1, fileCount: 30, lastSeen: '2023-05-20' },
    ],
    unlisted: 440,
  })

  assert({
    given: 'a full vocabulary',
    should: 'render every part in its place',
    actual: rendered,
    expected: [
      '### Tag Vocabulary',
      'Most active: Acme/Product/GTM (12 files, last 2026-01), Atlas/Tokens/ABC (3 files)',
      '',
      'Older and rarer (open a branch with tagsStartsWith): Archive/Deals/… (14 tags, 92 files, last 2025-02), ' +
        'Archive/… (5 other tags, 9 files, last 2024-01), Atlas-Legacy (30 files, last 2023-05)',
      '',
      'Plus 440 one-off tags not listed.',
    ].join('\n'),
  })
})

test('formatTagVocabulary - empty vocabulary renders nothing', () => {
  assert({
    given: 'no active tags and no branches',
    should: 'return empty string',
    actual: formatTagVocabulary(NO_TAGS),
    expected: '',
  })
})
