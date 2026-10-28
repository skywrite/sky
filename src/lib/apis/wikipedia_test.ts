import { spyOn } from 'bun:test'
import { assert, test } from '#test'
import { fetchWikipediaArticle, getWikipediaArticle, searchWikipedia } from './wikipedia.ts'

const ARTICLE = {
  title: 'Atlas',
  extract: 'Atlas is a synthetic article used to test the Wikipedia client.',
  fullurl: 'https://en.wikipedia.org/wiki/Atlas',
}
const ARTICLE_RESPONSE = { query: { pages: { '123': ARTICLE } } }

// Keep the API contract covered even when the public service is unavailable.
async function withResponses(responses: Response[], run: (requests: URL[]) => Promise<void>): Promise<void> {
  const requests: URL[] = []
  const request = spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
    requests.push(new URL(String(input)))
    const response = responses.shift()
    if (!response) throw new Error(`Unexpected Wikipedia request: ${input}`)
    return response
  }) as typeof fetch)
  try {
    await run(requests)
  } finally {
    request.mockRestore()
  }
}

test('searchWikipedia maps results and sends the search query and limit', async () => {
  const query = 'Atlas & Widget-V2'
  await withResponses(
    [Response.json([query, ['Atlas', 'Widget-V2'], ['A synthetic article.'], [ARTICLE.fullurl]])],
    async (requests) => {
      const results = await searchWikipedia(query, 3)
      assert({
        given: 'search results with an omitted description and URL',
        should: 'preserve the query, limit and result order, using empty strings for omitted fields',
        actual: [results, requests.map((url) => [url.origin + url.pathname, Object.fromEntries(url.searchParams)])],
        expected: [
          [
            { title: 'Atlas', description: 'A synthetic article.', url: ARTICLE.fullurl },
            { title: 'Widget-V2', description: '', url: '' },
          ],
          [
            [
              'https://en.wikipedia.org/w/api.php',
              { action: 'opensearch', search: query, limit: '3', format: 'json', origin: '*' },
            ],
          ],
        ],
      })
    },
  )
})

test('searchWikipedia returns no results and defaults to five matches', async () => {
  await withResponses([Response.json(['Missing widget', [], [], []])], async (requests) => {
    assert({
      given: 'a search with no matches',
      should: 'return an empty array and request the default result limit',
      actual: [await searchWikipedia('Missing widget'), requests[0].searchParams.get('limit')],
      expected: [[], '5'],
    })
  })
})

for (const fullContent of [false, true]) {
  test(`fetchWikipediaArticle fetches ${fullContent ? 'full content' : 'the introduction'}`, async () => {
    await withResponses([Response.json(ARTICLE_RESPONSE)], async (requests) => {
      const article = await fetchWikipediaArticle('Atlas alias', fullContent)
      assert({
        given: 'an article title that redirects to Atlas',
        should: 'request plain text in the selected scope and return the resolved title and URL',
        actual: [article, requests.map((url) => Object.fromEntries(url.searchParams))],
        expected: [
          {
            title: ARTICLE.title,
            extract: ARTICLE.extract,
            url: ARTICLE.fullurl,
            fullContent,
            isDisambiguation: false,
          },
          [
            {
              action: 'query',
              titles: 'Atlas alias',
              prop: 'extracts|info|pageprops',
              redirects: 'true',
              ...(!fullContent ? { exintro: 'true' } : {}),
              explaintext: 'true',
              inprop: 'url',
              format: 'json',
              origin: '*',
            },
          ],
        ],
      })
    })
  })
}

test('fetchWikipediaArticle preserves disambiguation and handles omitted extract and URL', async () => {
  await withResponses(
    [Response.json({ query: { pages: { '123': { title: 'Atlas widget', pageprops: { disambiguation: '' } } } } })],
    async () => {
      assert({
        given: 'a disambiguation page without an extract or URL',
        should: 'identify it and provide an empty extract and a title-based URL',
        actual: await fetchWikipediaArticle('Atlas widget'),
        expected: {
          title: 'Atlas widget',
          extract: '',
          url: 'https://en.wikipedia.org/wiki/Atlas_widget',
          fullContent: false,
          isDisambiguation: true,
        },
      })
    },
  )
})

test('fetchWikipediaArticle rejects missing articles', async () => {
  for (const response of [{}, { query: { pages: { '-1': { title: 'Missing widget', missing: '' } } } }]) {
    await withResponses([Response.json(response)], async () => {
      assert({
        given: 'an API response with no matching page',
        should: 'report the requested article as missing',
        actual: await fetchWikipediaArticle('Missing widget').catch((error: Error) => error.message),
        expected: 'Wikipedia article not found: Missing widget',
      })
    })
  }
})

for (const exactTitle of [undefined, 'Atlas']) {
  test(`getWikipediaArticle ${exactTitle ? 'fetches an exact title' : 'fetches the first search result'}`, async () => {
    const responses = [Response.json(ARTICLE_RESPONSE)]
    if (!exactTitle) responses.unshift(Response.json(['Atlas query', ['Atlas', 'Widget-V2'], [], []]))
    await withResponses(responses, async (requests) => {
      const article = await getWikipediaArticle('Atlas query', exactTitle)
      assert({
        given: exactTitle ? 'an exact title' : 'a search query',
        should: 'fetch the selected article and search only when needed',
        actual: [
          article,
          requests.map((url) => [
            url.searchParams.get('action'),
            url.searchParams.get('search'),
            url.searchParams.get('limit'),
            url.searchParams.get('titles'),
          ]),
        ],
        expected: [
          {
            title: ARTICLE.title,
            extract: ARTICLE.extract,
            url: ARTICLE.fullurl,
            fullContent: false,
            isDisambiguation: false,
          },
          exactTitle
            ? [['query', null, null, 'Atlas']]
            : [
                ['opensearch', 'Atlas query', '1', null],
                ['query', null, null, 'Atlas'],
              ],
        ],
      })
    })
  })
}

test('getWikipediaArticle reports searches with no matches', async () => {
  await withResponses([Response.json(['Missing widget', [], [], []])], async (requests) => {
    assert({
      given: 'a query with no matches',
      should: 'report the empty search without fetching an article',
      actual: [await getWikipediaArticle('Missing widget').catch((error: Error) => error.message), requests.length],
      expected: ['No Wikipedia articles found for: Missing widget', 1],
    })
  })
})

for (const [action, run] of [
  ['search', () => searchWikipedia('Atlas')],
  ['fetch', () => fetchWikipediaArticle('Atlas')],
] as const) {
  test(`Wikipedia ${action} reports service failures`, async () => {
    await withResponses([new Response('', { status: 503, statusText: 'Service Unavailable' })], async () => {
      assert({
        given: 'an unavailable Wikipedia API',
        should: 'report the failed operation instead of returning empty content',
        actual: await run().catch((error: Error) => error.message),
        expected: `Wikipedia ${action} failed: Service Unavailable`,
      })
    })
  })
}
