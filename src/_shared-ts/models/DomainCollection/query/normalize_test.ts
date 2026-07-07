import { assert, test } from '#test'
import { normalizeGraphQLQuery } from './normalize.ts'

test('normalizeGraphQLQuery', async (t) => {
  await t.step('passes through already-braced queries', () => {
    const query = '{ meetings(where: { recent: "7d" }) { path } }'
    assert({
      given: 'a query already wrapped in braces',
      should: 'return it unchanged',
      actual: normalizeGraphQLQuery(query),
      expected: query,
    })
  })

  await t.step('passes through named query operations', () => {
    const query = 'query Context { meetings { path } }'
    assert({
      given: 'a query using the query keyword',
      should: 'return it unchanged',
      actual: normalizeGraphQLQuery(query),
      expected: query,
    })
  })

  await t.step('wraps bare top-level selections in braces', () => {
    // The exact failure shape ai:context:evolve produced: bare selections
    // fail with 'Syntax Error: Unexpected Name "meetings".'
    const bare = 'meetings(where: { tags_starts_with: "Acme/" , recent: "18mo" }, limit: 10) { date summary path }'
    assert({
      given: 'a bare selection without enclosing braces',
      should: 'wrap it in { }',
      actual: normalizeGraphQLQuery(bare),
      expected: `{\n${bare}\n}`,
    })
  })

  await t.step('strips ```graphql code fences', () => {
    assert({
      given: 'a query wrapped in a graphql code fence',
      should: 'strip the fence',
      actual: normalizeGraphQLQuery('```graphql\n{ goals { path } }\n```'),
      expected: '{ goals { path } }',
    })
  })

  await t.step('strips plain ``` code fences', () => {
    assert({
      given: 'a query wrapped in a plain code fence',
      should: 'strip the fence',
      actual: normalizeGraphQLQuery('```\n{ goals { path } }\n```'),
      expected: '{ goals { path } }',
    })
  })

  await t.step('strips fences then wraps bare selections', () => {
    assert({
      given: 'a fenced bare selection',
      should: 'strip the fence and add braces',
      actual: normalizeGraphQLQuery('```graphql\nchats(limit: 5) { path }\n```'),
      expected: '{\nchats(limit: 5) { path }\n}',
    })
  })

  await t.step('returns empty string for empty input', () => {
    assert({
      given: 'whitespace-only input',
      should: 'return an empty string rather than wrapping it',
      actual: normalizeGraphQLQuery('   \n'),
      expected: '',
    })
  })
})
