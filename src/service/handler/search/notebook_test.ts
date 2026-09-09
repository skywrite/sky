import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createSearchRoutes } from './mod.ts'
import { searchAllNotebook, searchDate } from './notebook.ts'
import type { SearchResponse } from './types.ts'

const TODAY = new PlainDate('2026-01-28')
const DAY = 'time/2026/W05/01-27/day.md'

async function withNotebook(run: (store: MarkdownStore, base: string) => Promise<void> | void) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-search-test-'))
  try {
    for (const name of ['people', 'orgs', 'time']) await mkdir(path.join(base, name))
    const store = await MarkdownStore.build({
      peopleDirs: [path.join(base, 'people')],
      orgDirs: [path.join(base, 'orgs')],
      timeDirs: [path.join(base, 'time')],
      libraryDir: path.join(base, 'library'),
      projectsDir: path.join(base, 'projects'),
      placesDir: path.join(base, 'places'),
      goalsDir: path.join(base, 'goals'),
      aiDir: path.join(base, 'ai'),
    })
    await run(store, base)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test({ name: 'global search finds names, aliases, metadata and body text throughout the notebook' }, async () => {
  await withNotebook((store, base) => {
    store.set(
      path.join(base, 'people/Jane-Doe.md'),
      '---\nname: [Jane Doe, Jay]\nalt: JD\norg: Atlas Studio\n---\n\nEnjoys ceramics.\n',
    )
    store.set(path.join(base, 'orgs/Atlas.md'), '---\nname: Atlas Studio\n---\n\nA design studio.\n')
    store.set(path.join(base, 'places/Atlas-office.md'), '---\nname: Atlas office\n---\n\nThe Atlas meeting room.\n')
    store.set(path.join(base, 'library/Guide.md'), '---\ntitle: Field guide\n---\n\nPractical Atlas launch advice.\n')
    store.set(path.join(base, 'ai/memory/Design.md'), '---\ntitle: Design context\n---\n\nAtlas project context.\n')
    store.set(
      path.join(base, 'goals/professional.md'),
      '---\ntitle: Professional goals\n---\n\nFinish the Atlas launch.\n',
    )
    store.set(
      path.join(base, 'time/2026/W05/01-27/actions/ai-chats/10-00_Atlas.md'),
      '---\nsummary: Atlas planning\n---\n\nFirst launch plan.\n',
    )
    const search = (query: string) => searchAllNotebook(store, base, query, { today: TODAY })
    assert({
      given: 'a person with several aliases',
      should: 'return one canonical person for an alias',
      actual: search('jd').results.map((r) => [r.kind, r.title]),
      expected: [['person', 'Jane Doe']],
    })
    assert({
      given: 'a query matching organizations, linked people and text in several stores',
      should: 'include every matching type',
      actual: search('atlas')
        .results.map((r) => r.kind)
        .sort(),
      expected: ['org', 'person', 'place', 'library', 'note', 'goal', 'chat'].sort(),
    })
    assert({
      given: 'a term found only inside a profile body',
      should: 'find the person with a matching excerpt',
      actual: search('ceramics').results.map((r) => [r.kind, r.snippet?.includes('ceramics')]),
      expected: [['person', true]],
    })
  })
})

test({ name: 'global search ranks all matches before pagination and applies type filters before limits' }, async () => {
  await withNotebook((store, base) => {
    for (let i = 0; i < 70; i++)
      store.set(path.join(base, `people/Contact-${i}.md`), `---\nname: Atlas contact ${i}\n---\n`)
    store.set(path.join(base, 'orgs/Atlas.md'), '---\nname: Atlas\n---\n')
    const first = searchAllNotebook(store, base, 'atlas', { today: TODAY, limit: 1 })
    assert({
      given: 'an exact match added after seventy partial matches',
      should: 'rank it first without an early candidate cutoff',
      actual: [first.total, first.results[0]?.title],
      expected: [71, 'Atlas'],
    })
    const filtered = searchAllNotebook(store, base, 'atlas', { today: TODAY, kind: 'org', limit: 1 })
    assert({
      given: 'a type filter and a small page',
      should: 'count and return matches for that type',
      actual: [filtered.total, filtered.results[0]?.kind],
      expected: [1, 'org'],
    })
    const second = searchAllNotebook(store, base, 'atlas', { today: TODAY, offset: 40, limit: 40 })
    assert({
      given: 'the second page of results',
      should: 'return the remaining matches',
      actual: [second.results.length, second.offset],
      expected: [31, 40],
    })
  })
})

test({ name: 'global search observes store changes and configured reading boundaries' }, async () => {
  await withNotebook((store, base) => {
    const file = path.join(base, 'people/Jane-Doe.md')
    store.set(file, '---\nname: Jane Doe\n---\n\nOld context.\n')
    const search = (query: string) => searchAllNotebook(store, base, query, { today: TODAY })
    search('old')
    store.set(file, '---\nname: Jane Doe\n---\n\nNew context.\n')
    assert({
      given: 'a document changed after the search cache was built',
      should: 'search the new text and discard the old text',
      actual: [search('old').total, search('new').total],
      expected: [0, 1],
    })
    const restricted = searchAllNotebook(store, base, 'Jane', { today: TODAY, roots: [path.join(base, 'orgs')] })
    assert({
      given: 'a record outside the configured readable roots',
      should: 'exclude it from search and counts',
      actual: restricted.total,
      expected: 0,
    })
    store.delete(file)
    assert({
      given: 'a deleted record',
      should: 'remove it from search immediately',
      actual: search('Jane').total,
      expected: 0,
    })
  })
})

test({ name: 'global search includes project overviews and nested project documents' }, async () => {
  await withNotebook((store, base) => {
    store.set(path.join(base, 'projects/open/Atlas/_project/overview.md'), '---\nname: Atlas\n---\n\nWebsite launch.\n')
    store.set(
      path.join(base, 'projects/open/Atlas/design/review.md'),
      '---\ntitle: Design review\n---\n\nReview the Atlas first draft.\n',
    )
    const response = searchAllNotebook(store, base, 'Atlas', { today: TODAY })
    assert({
      given: 'a project with a document below its overview',
      should: 'return the project and its nested note',
      actual: response.results.map((item) => [item.kind, item.title]),
      expected: [
        ['project', 'Atlas'],
        ['note', 'Design review'],
      ],
    })
  })
})

test({ name: 'date searches use notebook days and route days separately from their documents' }, async () => {
  await withNotebook((store, base) => {
    store.set(path.join(base, DAY), '---\nupdated: 2026-01-28\n---\n\n# A useful Tuesday\n')
    store.set(
      path.join(base, 'time/2026/W05/01-27/actions/meetings/10-00_Atlas.md'),
      '---\nsummary: Atlas kickoff\n---\n',
    )
    const found = searchAllNotebook(store, base, 'yesterday', { today: TODAY })
    assert({
      given: 'a day file edited later and a meeting on that day',
      should: 'use the partition date and the normal day route',
      actual: [found.day?.href, found.day?.date, found.dayItems[0]?.kind, found.results.length],
      expected: ['/2026-01-27', '2026-01-27', 'meeting', 2],
    })
    const future = searchAllNotebook(store, base, 'tomorrow', { today: TODAY })
    assert({
      given: 'a day with no file yet',
      should: 'still offer navigation without inventing search matches',
      actual: [future.day?.href, future.total],
      expected: ['/2026-01-29', 0],
    })
    assert({
      given: 'weekdays and invalid dates',
      should: 'resolve relative to notebook time and reject invalid dates',
      actual: ['today', 'last wednesday', 'next wednesday', 'monday', '2026-02-30'].map(
        (q) => searchDate(q, TODAY)?.ymd ?? null,
      ),
      expected: ['2026-01-28', '2026-01-21', '2026-02-04', '2026-01-26', null],
    })
  })
})

test({ name: 'search routes report unavailable indexes and return paginated results' }, async () => {
  await withNotebook(async (store, base) => {
    const options = {
      base,
      roots: [base],
      scoring: { personScores: new Map(), orgScores: new Map() },
      today: () => TODAY,
    }
    const unavailable = createSearchRoutes({ ...options, store: null })
    assert({
      given: 'an index that is still loading',
      should: 'return a retriable error',
      actual: (await unavailable.request('http://localhost/?q=Atlas')).status,
      expected: 503,
    })
    store.set(path.join(base, 'orgs/Atlas.md'), '---\nname: Atlas Studio\n---\n')
    const routes = createSearchRoutes({ ...options, store })
    const response = await routes.request('http://localhost/?q=Atlas&kind=org&offset=-4&limit=NaN')
    const body = (await response.json()) as SearchResponse
    assert({
      given: 'a valid query with invalid pagination input',
      should: 'return the matching organization using safe defaults',
      actual: [response.status, body.total, body.offset, body.results[0]?.href, body.today],
      expected: [200, 1, 0, '/explorer/orgs/Atlas.md', '2026-01-28'],
    })
  })
})
