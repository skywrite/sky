import { assert, test } from '#test'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { FIXTURES_DIR } from '../../fixtures/mod.ts'
import { searchNotebook } from './searchNotebook.ts'

const storePromise = MarkdownStore.build({
  peopleDirs: [`${FIXTURES_DIR}/people`],
  orgDirs: [`${FIXTURES_DIR}/orgs`],
  projectsDir: `${FIXTURES_DIR}/projects`,
  timeDirs: [`${FIXTURES_DIR}/time`],
})

test({ name: 'searchNotebook - empty query returns nothing' }, async () => {
  const store = await storePromise

  assert({
    given: 'an empty query',
    should: 'return no results',
    actual: searchNotebook(store, FIXTURES_DIR, '   '),
    expected: [],
  })
})

test({ name: 'searchNotebook - finds people by name' }, async () => {
  const store = await storePromise
  const results = searchNotebook(store, FIXTURES_DIR, 'rivera')

  assert({
    given: 'a query matching a person name',
    should: 'rank the person first',
    actual: { kind: results[0]?.kind, title: results[0]?.title, relativePath: results[0]?.relativePath },
    expected: { kind: 'person', title: 'Alex Rivera', relativePath: 'people/Alex-Rivera.md' },
  })
})

test({ name: 'searchNotebook - ranks entities above documents' }, async () => {
  const store = await storePromise
  const results = searchNotebook(store, FIXTURES_DIR, 'acme')

  assert({
    given: 'a query matching an org and documents mentioning it',
    should: 'rank the org first',
    actual: { kind: results[0]?.kind, title: results[0]?.title },
    expected: { kind: 'org', title: 'Acme Corp' },
  })

  assert({
    given: 'a query matching an org and documents mentioning it',
    should: 'still include documents',
    actual: results.some((result) => result.kind === 'doc'),
    expected: true,
  })
})

test({ name: 'searchNotebook - uses frontmatter summary as document title' }, async () => {
  const store = await storePromise
  const results = searchNotebook(store, FIXTURES_DIR, 'deployment')

  assert({
    given: 'a query matching a document path and body',
    should: 'title the document from its summary frontmatter',
    actual: results.some((result) => result.title === 'Production Deployment Issue'),
    expected: true,
  })
})

test({ name: 'searchNotebook - body-only matches carry a snippet' }, async () => {
  const store = await storePromise
  const results = searchNotebook(store, FIXTURES_DIR, 'exhausted')
  const match = results.find((result) => result.relativePath.endsWith('slack_Sarah-Mitchell_Deployment-Issue.md'))

  assert({
    given: 'a term that appears only in a document body',
    should: 'return that document',
    actual: match !== undefined,
    expected: true,
  })

  assert({
    given: 'a body-only match',
    should: 'include a snippet around the term',
    actual: (match?.snippet ?? '').toLowerCase().includes('exhausted'),
    expected: true,
  })
})

test({ name: 'searchNotebook - orders entities by interaction score' }, async () => {
  const store = await storePromise
  const orgScores = new Map<string, { score: number }>()

  const lisaFirst = searchNotebook(store, FIXTURES_DIR, 'chen', 20, undefined, {
    personScores: new Map([
      ['Lisa Chen', { score: 42 }],
      ['Chen Wei', { score: 3 }],
    ]),
    orgScores,
  })

  assert({
    given: 'two matching people where Lisa Chen has the higher interaction score',
    should: 'rank Lisa Chen first',
    actual: lisaFirst[0]?.title,
    expected: 'Lisa Chen',
  })

  const chenWeiFirst = searchNotebook(store, FIXTURES_DIR, 'chen', 20, undefined, {
    personScores: new Map([
      ['Lisa Chen', { score: 3 }],
      ['Chen Wei', { score: 42 }],
    ]),
    orgScores,
  })

  assert({
    given: 'the same query with the scores flipped',
    should: 'rank Chen Wei first',
    actual: chenWeiFirst[0]?.title,
    expected: 'Chen Wei',
  })
})

test({ name: 'searchNotebook - respects the limit' }, async () => {
  const store = await storePromise
  const results = searchNotebook(store, FIXTURES_DIR, 'a', 3)

  assert({
    given: 'a broad query with a limit of 3',
    should: 'return at most 3 results',
    actual: results.length <= 3,
    expected: true,
  })
})
