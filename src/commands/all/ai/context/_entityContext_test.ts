import { assert, test } from '#test'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import {
  type EntityContext,
  formatEntityContext,
  formatPeopleBlock,
  mergeScoredPeople,
  type PersonEntity,
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
    recentTags: ['Acme/Product/GTM', 'Assets/Crypto/BTC'],
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
    should: 'contain Recent Tags section',
    actual: result.includes('### Recent Tags (last 6 months)'),
    expected: true,
  })

  assert({
    given: 'all sections populated',
    should: 'contain tag names',
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
    recentTags: ['Some/Tag'],
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
    should: 'contain Recent Tags section',
    actual: result.includes('### Recent Tags'),
    expected: true,
  })
})

test('formatEntityContext - all empty returns empty string', () => {
  const ctx: EntityContext = {
    people: [],
    projects: [],
    decisions: [],
    goals: [],
    recentTags: [],
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
