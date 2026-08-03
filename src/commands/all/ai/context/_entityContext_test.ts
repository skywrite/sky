import { assert, test } from '#test'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import {
  type EntityContext,
  formatEntityContext,
  formatPeopleBlock,
  mergeScoredPeople,
  type PersonEntity,
  selectTagVocabulary,
} from './_entityContext.ts'

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
    tags: [
      { name: 'Acme/Product/GTM', fileCount: 12, lastSeen: '2026-01-20' },
      { name: 'Assets/Crypto/BTC', fileCount: 3, lastSeen: null },
    ],
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
    should: 'contain Tag Vocabulary section',
    actual: result.includes('### Tag Vocabulary (most active)'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'render tags as bare names',
    actual: result.includes('Acme/Product/GTM, Assets/Crypto/BTC'),
    expected: true,
  })
})

test('formatEntityContext - empty sections omitted', () => {
  const ctx: EntityContext = {
    people: [],
    projects: ['Only-Project'],
    decisions: [],
    goals: [],
    tags: [{ name: 'Some/Tag', fileCount: 4, lastSeen: '2026-01-05' }],
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
    tags: [],
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
// selectTagVocabulary
// ---------------------------------------------------------------------------

test('selectTagVocabulary - keeps the top-scored tags, listed alphabetically', () => {
  const rows = [
    { name: 'Work/Cloud', score: 9, lastSeen: '2026-01-27', fileCount: 40 },
    { name: 'Atlas/Beta', score: 5, lastSeen: '2026-01-10', fileCount: 12 },
    { name: 'Dormant/Theme', score: 0.2, lastSeen: '2024-06-01', fileCount: 80 },
  ]

  assert({
    given: 'three scored tags and a limit of 2',
    should: 'select by score but order the result alphabetically',
    actual: selectTagVocabulary(rows, 2).map((t) => t.name),
    expected: ['Atlas/Beta', 'Work/Cloud'],
  })
})

test('selectTagVocabulary - carries fileCount and lastSeen through, dropping the score', () => {
  const rows = [{ name: 'Atlas/Beta', score: 5, lastSeen: null, fileCount: 12 }]

  assert({
    given: 'a scored row',
    should: 'map to a vocabulary entry without the score',
    actual: selectTagVocabulary(rows),
    expected: [{ name: 'Atlas/Beta', fileCount: 12, lastSeen: null }],
  })
})

test('selectTagVocabulary - does not reorder the caller’s array', () => {
  const rows = [
    { name: 'B/Low', score: 1, lastSeen: null, fileCount: 1 },
    { name: 'A/High', score: 9, lastSeen: null, fileCount: 9 },
  ]
  selectTagVocabulary(rows, 1)

  assert({
    given: 'a score-unsorted input array',
    should: 'leave the input untouched',
    actual: rows.map((r) => r.name),
    expected: ['B/Low', 'A/High'],
  })
})
