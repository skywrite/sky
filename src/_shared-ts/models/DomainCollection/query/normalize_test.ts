import { assert, test } from '#test'
import { graphQLParseError, graphQLValidationErrors, normalizeGraphQLQuery } from './normalize.ts'

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
    const bare = 'meetings(where: { tagsStartsWith: "Acme/" , recent: "18mo" }, limit: 10) { date summary path }'
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

  await t.step('auto-aliases duplicate fields with differing arguments', () => {
    // The exact failure shape ai:context:evolve produced: the same root
    // field selected twice with different where-args and no aliases, which
    // execution rejects wholesale ('Fields "meetings" conflict because they
    // have differing arguments').
    const conflicted = '{meetings(where:{involves:"A"},limit:2){path}meetings(where:{involves:"B"},limit:2){path}}'
    assert({
      given: 'two selections of the same field with differing arguments',
      should: 'alias the second occurrence',
      actual: normalizeGraphQLQuery(conflicted),
      expected: `{
  meetings(where: {involves: "A"}, limit: 2) {
    path
  }
  meetings2: meetings(where: {involves: "B"}, limit: 2) {
    path
  }
}`,
    })
  })

  await t.step('leaves identical duplicate selections alone', () => {
    const query = '{ goals { path } goals { path } }'
    assert({
      given: 'duplicate selections with identical name and arguments',
      should: 'return the query unchanged — GraphQL merges these validly',
      actual: normalizeGraphQLQuery(query),
      expected: query,
    })
  })

  await t.step('treats reordered arguments as identical, not conflicting', () => {
    const query =
      '{ meetings(limit: 2, where: {recent: "7d"}) { path } meetings(where: {recent: "7d"}, limit: 2) { path } }'
    assert({
      given: 'duplicate selections whose arguments differ only in order',
      should: 'return the query unchanged — argument order is irrelevant in GraphQL',
      actual: normalizeGraphQLQuery(query),
      expected: query,
    })
  })

  await t.step('numbers generated aliases past existing response keys', () => {
    const query =
      '{ messages2: messages(where: {a: "x"}) { path } messages(where: {a: "y"}) { path } messages(where: {a: "z"}) { path } }'
    assert({
      given: 'a conflict where the natural alias is already taken',
      should: 'skip to the next free number instead of colliding',
      actual: normalizeGraphQLQuery(query),
      expected: `{
  messages2: messages(where: {a: "x"}) {
    path
  }
  messages(where: {a: "y"}) {
    path
  }
  messages3: messages(where: {a: "z"}) {
    path
  }
}`,
    })
  })

  await t.step('auto-aliases conflicts in nested selection sets', () => {
    assert({
      given: 'a differing-arguments conflict below the root',
      should: 'alias the nested duplicate too',
      actual: normalizeGraphQLQuery('{ wrapper { thing(x: 1) { p } thing(x: 2) { p } } }'),
      expected: `{
  wrapper {
    thing(x: 1) {
      p
    }
    thing2: thing(x: 2) {
      p
    }
  }
}`,
    })
  })

  await t.step('returns unparseable strings unchanged', () => {
    // Auto-aliasing needs a parse; garbage must flow through untouched so
    // graphQLParseError still catches and drops it downstream.
    const garbage = '{\nchanged:true}\n}'
    assert({
      given: 'a non-GraphQL string that survives shape normalization',
      should: 'return it unchanged for the parse guard to reject',
      actual: normalizeGraphQLQuery(garbage),
      expected: garbage,
    })
  })
})

test('graphQLParseError', async (t) => {
  await t.step('returns null for a valid query', () => {
    assert({
      given: 'a parseable GraphQL query',
      should: 'return null',
      actual: graphQLParseError('{ goals { path } }'),
      expected: null,
    })
  })

  await t.step('returns the parse error for envelope-fragment garbage', () => {
    // The exact string ai:context:evolve leaked into its queries array:
    // a fragment of the model's own structured-output envelope. It starts
    // with "{" so shape normalization passes it through — only parsing
    // catches it.
    assert({
      given: 'a non-GraphQL string that survives normalization',
      should: 'return a syntax error message',
      actual: (graphQLParseError('{\nchanged:true}\n}') ?? '').startsWith('Syntax Error'),
      expected: true,
    })
  })
})

test('graphQLValidationErrors', async (t) => {
  await t.step('returns null for a schema-valid query', async () => {
    assert({
      given: 'a query using real schema fields',
      should: 'return null',
      actual: await graphQLValidationErrors('{ messages(where: { bodyContains: "x" }, limit: 2) { path } }'),
      expected: null,
    })
  })

  await t.step('reports hallucinated filter fields', async () => {
    // Parses fine, fails against the schema — the class of model error the
    // parse-only guard could not catch (e.g. reverting to the retired
    // snake_case spelling after the camelCase rename).
    const errors = await graphQLValidationErrors('{ messages(where: { body_contains: "x" }) { path } }')
    assert({
      given: 'a query using a filter field the schema does not define',
      should: 'return the validation error naming the field',
      actual: errors !== null && errors[0].includes('body_contains'),
      expected: true,
    })
  })

  await t.step('reports parse failures through the same guard', async () => {
    const errors = await graphQLValidationErrors('{\nchanged:true}\n}')
    assert({
      given: 'an unparseable string',
      should: 'return the syntax error as the message list',
      actual: (errors?.[0] ?? '').startsWith('Syntax Error'),
      expected: true,
    })
  })
})
