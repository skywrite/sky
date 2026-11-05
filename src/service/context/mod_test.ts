import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { PersonContact } from '#shared/models/Person/contact.ts'
import { assert, test } from '#test'
import { FIXTURE_PATHS } from '../fixtures/mod.ts'
import { resolveContext } from './mod.ts'

async function buildStore(): Promise<MarkdownStore> {
  return MarkdownStore.build({
    peopleDirs: [FIXTURE_PATHS.people, FIXTURE_PATHS.peopleOld],
    orgDirs: [FIXTURE_PATHS.orgs],
    projectsDir: FIXTURE_PATHS.projects,
    timeDirs: [FIXTURE_PATHS.time],
  })
}

// =============================================================================
// Basic query tests
// =============================================================================

test('resolveContext - returns documents matching query', async () => {
  const store = await buildStore()

  const result = await resolveContext('{ people(where: { name: "Lisa Chen" }) { path } }', 0, store)

  assert({
    given: 'query for Lisa Chen with depth 0',
    should: 'return at least 1 document',
    actual: result.count >= 1,
    expected: true,
  })

  const types = result.documents.map((d) => d.type)
  assert({
    given: 'query for Lisa Chen with depth 0',
    should: 'include a person document',
    actual: types.includes('person'),
    expected: true,
  })
})

test('resolveContext - depth 0 returns only root documents', async () => {
  const store = await buildStore()

  const result = await resolveContext('{ people(where: { name: "Lisa Chen" }) { path } }', 0, store)

  // Lisa has org: Google, but depth 0 should NOT include it
  const types = result.documents.map((d) => d.type)
  assert({
    given: 'depth 0 query for Lisa Chen',
    should: 'not include org documents',
    actual: types.includes('org'),
    expected: false,
  })
})

test('resolveContext - depth 1 resolves direct relationships', async () => {
  const store = await buildStore()

  const result = await resolveContext('{ people(where: { name: "Lisa Chen" }) { path } }', 1, store)

  // Lisa has org: Google → depth 1 should resolve the org
  const types = result.documents.map((d) => d.type)
  assert({
    given: 'depth 1 query for Lisa Chen',
    should: 'include the person document',
    actual: types.includes('person'),
    expected: true,
  })

  assert({
    given: 'depth 1 query for Lisa Chen (who has org: Google)',
    should: 'include resolved org document',
    actual: types.includes('org'),
    expected: true,
  })

  assert({
    given: 'depth 1 query for Lisa Chen',
    should: 'return more documents than depth 0',
    actual: result.count >= 2,
    expected: true,
  })
})

test('resolveContext - document query resolves relationships via involves', async () => {
  const store = await buildStore()

  // Fixture time docs have who: Lisa Chen → involves filter matches
  // Depth 1 should resolve Lisa Chen as a person document
  const result = await resolveContext('{ documents(where: { involves: "Lisa Chen" }) { path } }', 1, store)

  const types = result.documents.map((d) => d.type)

  assert({
    given: 'document query filtered by involves: Lisa Chen',
    should: 'include document results',
    actual: types.includes('document'),
    expected: true,
  })

  assert({
    given: 'document involving Lisa Chen at depth 1',
    should: 'include resolved person document',
    actual: types.includes('person'),
    expected: true,
  })
})

test('resolveContext - depth 2 resolves transitive relationships', async () => {
  const store = await buildStore()

  // Meeting doc has who: Lisa Chen + rel: Google (depth 1 resolves both)
  // Lisa Chen has org: Google (depth 2 follows Lisa → Google transitively)
  // With fixture data, depth 2 should return >= depth 1 results
  const depth1 = await resolveContext('{ documents(where: { involves: "Lisa Chen" }) { path } }', 1, store)
  const depth2 = await resolveContext('{ documents(where: { involves: "Lisa Chen" }) { path } }', 2, store)

  assert({
    given: 'depth 2 vs depth 1',
    should: 'return at least as many documents as depth 1',
    actual: depth2.count >= depth1.count,
    expected: true,
  })

  // Depth 2 should still include the transitive org
  const depth2Types = depth2.documents.map((d) => d.type)
  assert({
    given: 'depth 2 query starting from meeting involving Lisa Chen',
    should: 'include org via transitive resolution (Lisa Chen → Google)',
    actual: depth2Types.includes('org'),
    expected: true,
  })
})

// =============================================================================
// Edge cases
// =============================================================================

test('resolveContext - empty result for non-matching query', async () => {
  const store = await buildStore()

  const result = await resolveContext('{ people(where: { name: "Nobody" }) { path } }', 1, store)

  assert({
    given: 'query matching no documents',
    should: 'return empty documents array',
    actual: result.documents.length,
    expected: 0,
  })

  assert({
    given: 'query matching no documents',
    should: 'return count 0',
    actual: result.count,
    expected: 0,
  })
})

test('resolveContext - documents include markdown content', async () => {
  const store = await buildStore()

  const result = await resolveContext('{ people(where: { name: "Lisa Chen" }) { path } }', 0, store)

  const lisa = result.documents.find((d) => d.type === 'person')

  assert({
    given: 'query for Lisa Chen',
    should: 'include markdown with frontmatter',
    actual: lisa?.markdown.includes('name: Lisa Chen'),
    expected: true,
  })

  assert({
    given: 'query for Lisa Chen',
    should: 'include markdown body',
    actual: lisa?.markdown.includes('Engineering Director'),
    expected: true,
  })
})

test('resolveContext - invalid query throws error', async () => {
  const store = await buildStore()

  let error: Error | null = null
  try {
    await resolveContext('{ invalidQuery }', 0, store)
  } catch (err) {
    error = err as Error
  }

  assert({
    given: 'invalid GraphQL query',
    should: 'throw an error',
    actual: error !== null,
    expected: true,
  })

  assert({
    given: 'invalid GraphQL query',
    should: 'error message contains GraphQL',
    actual: error?.message.includes('GraphQL'),
    expected: true,
  })
})

test('resolveContext - deduplicates documents across queries', async () => {
  const store = await buildStore()

  // Lisa Chen appears in people query AND via documents involves resolution
  const result = await resolveContext(
    '{ people(where: { name: "Lisa Chen" }) { path } documents(where: { involves: "Lisa Chen" }) { path } }',
    1,
    store,
  )

  const lisaDocs = result.documents.filter((d) => d.type === 'person' && d.markdown.includes('Lisa Chen'))

  assert({
    given: 'query that could return Lisa Chen from both people and documents',
    should: 'deduplicate - Lisa Chen appears only once',
    actual: lisaDocs.length,
    expected: 1,
  })
})

test('resolveContext - people come most active first, each with a line on how much you are in touch', async () => {
  const store = await buildStore()
  const scores: Record<string, number> = { 'kai hansen': 40, 'lisa chen': 90 }
  const contacts: Record<string, PersonContact> = {
    'lisa chen': { rank: 1, lastContact: '2026-10-28' },
    'kai hansen': { rank: 12, lastContact: null },
  }
  const result = await resolveContext('{ people(where: { nameContains: "a" }) { path } }', 0, store, {
    scoreFor: (name) => scores[name.toLowerCase()] ?? 0,
    contactOf: (names) => contacts[names[0]!.toLowerCase()] ?? null,
  })
  const people = result.documents.filter((doc) => doc.type === 'person')
  const lineOf = (name: string) => {
    const doc = people.find((item) => item.path.endsWith(`/${name}.md`))!
    return doc.markdown.split('\n').find((line) => line.startsWith('> Contact:'))
  }
  assert({
    given: 'people with interaction scores, one with none, and the contact lines the service would show',
    should: 'put the most active first and open each profile with how much you are in touch',
    actual: {
      first: people.slice(0, 2).map((doc) => doc.path.split('/').at(-1)),
      lisa: [lineOf('Lisa-Chen'), people.find((doc) => doc.path.endsWith('/Lisa-Chen.md'))?.contact],
      kai: lineOf('Kai-Hansen'),
      casey: lineOf('Casey-Arden'),
      frontmatterFirst: people.every((doc) => doc.markdown.startsWith('---\n')),
    },
    expected: {
      first: ['Lisa-Chen.md', 'Kai-Hansen.md'],
      lisa: [
        '> Contact: your 1st most active contact · last in touch 2026-10-28',
        { rank: 1, lastContact: '2026-10-28' },
      ],
      kai: '> Contact: your 12th most active contact',
      casey: '> Contact: no contact logged',
      frontmatterFirst: true,
    },
  })
})
