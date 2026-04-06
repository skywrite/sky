import { assert, test } from '#test'
import { fetchWikipediaArticle, getWikipediaArticle, searchWikipedia } from './wikipedia.ts'
import isOnline from '#shared/network/isOnline.ts'

const ignore = !(await isOnline())

const searchFixtures = [
  {
    description: 'valid search query returns results',
    query: 'Anthropic',
    limit: 3,
    expectedMinResults: 1,
    shouldHaveUrl: true,
  },
  {
    description: 'non-existent query returns empty array',
    query: 'xyzabc123nonexistentquery999',
    limit: 3,
    expectedMinResults: 0,
    shouldHaveUrl: false,
  },
]

searchFixtures.forEach((fixture) => {
  test({ name: `searchWikipedia - ${fixture.description}`, ignore }, async () => {
    const results = await searchWikipedia(fixture.query, fixture.limit)

    assert({
      given: `search query: ${fixture.query}`,
      should: `return ${fixture.expectedMinResults > 0 ? 'at least one result' : 'empty array'}`,
      actual: results.length >= fixture.expectedMinResults,
      expected: true,
    })

    if (fixture.shouldHaveUrl && results.length > 0) {
      assert({
        given: 'search result',
        should: 'have title',
        actual: typeof results[0].title,
        expected: 'string',
      })

      assert({
        given: 'search result',
        should: 'have Wikipedia URL',
        actual: results[0].url.startsWith('https://en.wikipedia.org/wiki/'),
        expected: true,
      })
    }
  })
})

const fetchFixtures = [
  {
    description: 'Anthropic article',
    title: 'Anthropic',
    shouldSucceed: true,
    expectedTitle: 'Anthropic',
  },
  {
    description: 'Rockbridge Network article',
    title: 'Rockbridge Network',
    shouldSucceed: true,
    expectedTitle: 'Rockbridge Network',
  },
  {
    description: 'non-existent article',
    title: 'Nonexistent Article That Does Not Exist 123456789',
    shouldSucceed: false,
    expectedTitle: null,
  },
]

fetchFixtures.forEach((fixture) => {
  test({ name: `fetchWikipediaArticle - ${fixture.description}`, ignore }, async () => {
    if (fixture.shouldSucceed) {
      const article = await fetchWikipediaArticle(fixture.title)

      assert({
        given: `article title: ${fixture.title}`,
        should: 'return correct title',
        actual: article.title,
        expected: fixture.expectedTitle,
      })

      assert({
        given: `article title: ${fixture.title}`,
        should: 'have non-empty extract',
        actual: article.extract.length > 0,
        expected: true,
      })

      assert({
        given: `article title: ${fixture.title}`,
        should: 'have Wikipedia URL',
        actual: article.url.startsWith('https://en.wikipedia.org/wiki/'),
        expected: true,
      })
    } else {
      let errorThrown = false
      try {
        await fetchWikipediaArticle(fixture.title)
      } catch (_error) {
        errorThrown = true
      }

      assert({
        given: `non-existent article title: ${fixture.title}`,
        should: 'throw error',
        actual: errorThrown,
        expected: true,
      })
    }
  })
})

const getArticleFixtures = [
  {
    description: 'with exact title',
    query: 'Anthropic',
    exactTitle: 'Anthropic',
    expectedTitle: 'Anthropic',
  },
  {
    description: 'with search query',
    query: 'Anthropic',
    exactTitle: undefined,
    expectedTitle: undefined, // Will verify it has content
  },
]

getArticleFixtures.forEach((fixture) => {
  test({ name: `getWikipediaArticle - ${fixture.description}`, ignore }, async () => {
    const article = await getWikipediaArticle(fixture.query, fixture.exactTitle)

    if (fixture.expectedTitle) {
      assert({
        given: `query: ${fixture.query}${fixture.exactTitle ? `, exact title: ${fixture.exactTitle}` : ''}`,
        should: 'return article with correct title',
        actual: article.title,
        expected: fixture.expectedTitle,
      })
    }

    assert({
      given: `query: ${fixture.query}`,
      should: 'have extract content',
      actual: article.extract.length > 0,
      expected: true,
    })
  })
})
