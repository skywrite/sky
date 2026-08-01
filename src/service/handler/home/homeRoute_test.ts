import { assert, test } from '#test'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { FIXTURES_DIR } from '../../fixtures/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'

const storePromise = MarkdownStore.build({
  peopleDirs: [`${FIXTURES_DIR}/people`],
  orgDirs: [`${FIXTURES_DIR}/orgs`],
  projectsDir: `${FIXTURES_DIR}/projects`,
  timeDirs: [`${FIXTURES_DIR}/time`],
})

// NOTE: `/` now serves the client app shell (see theme/themeRoute_test.ts).
// The SSR home renderer is unrouted but kept — its search API lives on below.

test({ name: 'search api - 503 before the index is ready' }, async () => {
  const app = createTestHttpApp([FIXTURES_DIR])
  const response = await app.request('http://localhost/docs/_api/search?q=test')

  assert({
    given: 'a search before the markdown store is built',
    should: 'return 503',
    actual: response.status,
    expected: 503,
  })
})

test({ name: 'search api - returns entity matches' }, async () => {
  const app = createTestHttpApp([FIXTURES_DIR], { markdownStore: await storePromise })
  const response = await app.request('http://localhost/docs/_api/search?q=rivera')
  const payload = (await response.json()) as { query: string; results: Array<{ title: string; kind: string }> }

  assert({
    given: 'a search for a fixture person',
    should: 'return 200',
    actual: response.status,
    expected: 200,
  })

  assert({
    given: 'a search for a fixture person',
    should: 'rank the person first',
    actual: { kind: payload.results[0]?.kind, title: payload.results[0]?.title },
    expected: { kind: 'person', title: 'Alex Rivera' },
  })
})

test({ name: 'search api - empty query and limit clamping' }, async () => {
  const app = createTestHttpApp([FIXTURES_DIR], { markdownStore: await storePromise })

  const empty = (await (await app.request('http://localhost/docs/_api/search?q=')).json()) as { results: unknown[] }
  assert({
    given: 'an empty query',
    should: 'return no results',
    actual: empty.results,
    expected: [],
  })

  const clamped = (await (await app.request('http://localhost/docs/_api/search?q=a&limit=999')).json()) as {
    results: unknown[]
  }
  assert({
    given: 'an oversized limit',
    should: 'clamp results to at most 50',
    actual: clamped.results.length <= 50,
    expected: true,
  })
})
