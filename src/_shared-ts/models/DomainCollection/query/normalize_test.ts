import { assert, test } from '#test'
import {
  dropInvalidSelections,
  graphQLParseError,
  graphQLValidationErrors,
  normalizeGraphQLQuery,
} from './normalize.ts'

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

  await t.step('merges several fenced blocks into one query', () => {
    // Models emit one block per question instead of one aliased query; the
    // interior fences used to leave the document unparseable.
    const reply = [
      '```graphql',
      '{ atlasChats: chats(where: { bodyContains: "Atlas" }, limit: 10) { path } }',
      '```',
      '',
      '```graphql',
      '{ atlasDocs: documents(where: { bodyContains: "Atlas" }, limit: 10) { path } }',
      '```',
    ].join('\n')
    const normalized = normalizeGraphQLQuery(reply)
    assert({
      given: 'a reply containing two fenced query blocks',
      should: 'keep both root selections in a single parseable document',
      actual:
        graphQLParseError(normalized) === null && normalized.includes('atlasChats') && normalized.includes('atlasDocs'),
      expected: true,
    })
  })

  await t.step('drops prose mixed in with a fenced block', () => {
    const reply = [
      "I can't reach that URL, but here is what the notebook has:",
      '',
      '```graphql',
      '{ atlasDocs: documents(where: { bodyContains: "Atlas" }, limit: 10) { path } }',
      '```',
    ].join('\n')
    const normalized = normalizeGraphQLQuery(reply)
    assert({
      given: 'commentary preceding a fenced query',
      should: 'return just the query',
      actual: graphQLParseError(normalized) === null && normalized.includes('atlasDocs'),
      expected: true,
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

  await t.step('hoists a misplaced filter arg into a new where', () => {
    // The 2026-07-10 failure shape: `recent` left in field-argument
    // position fails validation with 'Unknown argument "recent" on field
    // "Query.journals"' and voids the whole document.
    assert({
      given: 'a filter key passed as a field argument with no where',
      should: 'move it into a fresh where object',
      actual: normalizeGraphQLQuery('{ recentJournals: journals(recent: "7d", limit: 10) { date } }'),
      expected: `{
  recentJournals: journals(where: {recent: "7d"}, limit: 10) {
    date
  }
}`,
    })
  })

  await t.step('merges a misplaced filter arg into an existing where', () => {
    // The 2026-07-12 failure shape: the model closed `where` after the tag
    // filter and appended `involves` as a sibling argument.
    const query =
      '{ docs: documents(where: {tagsStartsWith: "Acme/Talent"}, involves: "Alice Hart", limit: 10) { path } }'
    assert({
      given: 'a filter key passed as a sibling of where',
      should: 'merge it into the where object, keeping other arguments',
      actual: normalizeGraphQLQuery(query),
      // print() wraps argument lists past 80 chars onto separate lines
      expected: `{
  docs: documents(
    where: {tagsStartsWith: "Acme/Talent", involves: "Alice Hart"}
    limit: 10
  ) {
    path
  }
}`,
    })
  })

  await t.step('keeps the where value when a stray duplicates its key', () => {
    assert({
      given: 'a misplaced argument whose key already exists in where',
      should: 'drop the stray rather than overwrite the where value',
      actual: normalizeGraphQLQuery('{ documents(where: {involves: "A"}, involves: "B", limit: 5) { path } }'),
      expected: `{
  documents(where: {involves: "A"}, limit: 5) {
    path
  }
}`,
    })
  })

  await t.step('leaves nested field arguments alone when hoisting', () => {
    const query = '{ wrapper { thing(x: 1) { p } } }'
    assert({
      given: 'arguments on fields below the root',
      should: 'return the query unchanged — only root fields take where/limit',
      actual: normalizeGraphQLQuery(query),
      expected: query,
    })
  })

  await t.step('leaves selections whose where is a variable alone', () => {
    const query = 'query ($w: MessageFilter) { messages(where: $w, recent: "7d") { path } }'
    assert({
      given: 'a stray argument beside a non-literal where',
      should: 'return the query unchanged for validation to report',
      actual: normalizeGraphQLQuery(query),
      expected: query,
    })
  })

  await t.step('hoists before aliasing so repaired duplicates still alias', () => {
    assert({
      given: 'two same-field selections that differ only in misplaced args',
      should: 'hoist both and alias the second',
      actual: normalizeGraphQLQuery('{documents(involves:"A"){path}documents(involves:"B"){path}}'),
      expected: `{
  documents(where: {involves: "A"}) {
    path
  }
  documents2: documents(where: {involves: "B"}) {
    path
  }
}`,
    })
  })

  await t.step('hoisting yields a schema-valid document for the 2026-07-12 shape', async () => {
    // End-to-end guard for the incident: one misplaced `involves` voided an
    // eight-selection context query. After normalization the document must
    // validate clean.
    const query = `query {
  msgs: messages(where: { involves: "Alice Hart" }, limit: 20) { path }
  meets: meetings(where: { involves: "Alice Hart" }, limit: 20) { path }
  docs: documents(where: { tagsStartsWith: "Acme/Talent" }, involves: "Alice Hart", limit: 10) { path }
  person: people(where: { nameContains: "Alice Hart" }, limit: 3) { path }
}`
    assert({
      given: 'the misplaced-involves incident shape',
      should: 'validate clean after normalization',
      actual: await graphQLValidationErrors(normalizeGraphQLQuery(query)),
      expected: null,
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

test('dropInvalidSelections', async (t) => {
  await t.step('returns a valid document unchanged', async () => {
    const query = '{ messages(where: { bodyContains: "x" }, limit: 2) { path } }'
    const result = await dropInvalidSelections(query)
    assert({
      given: 'a schema-valid query',
      should: 'return it unchanged',
      actual: result?.query,
      expected: query,
    })
    assert({
      given: 'a schema-valid query',
      should: 'report nothing dropped',
      actual: result?.dropped.length,
      expected: 0,
    })
  })

  await t.step('drops only the invalid selection', async () => {
    // The blast-radius failure: GraphQL validates the whole document up
    // front, so one hallucinated filter field used to cost every selection.
    const query =
      '{ msgs: messages(where: {bodyContains: "x"}) { path } bad: messages(where: {body_contains: "x"}) { path } }'
    const result = await dropInvalidSelections(query)
    assert({
      given: 'one invalid selection among valid ones',
      should: 'keep the valid selection executable',
      actual: result?.query,
      expected: `{
  msgs: messages(where: {bodyContains: "x"}) {
    path
  }
}`,
    })
    assert({
      given: 'one invalid selection among valid ones',
      should: 'report the dropped response key',
      actual: result?.dropped.map((d) => d.key).join(','),
      expected: 'bad',
    })
    assert({
      given: 'one invalid selection among valid ones',
      should: 'carry the validator message for the dropped key',
      actual: result?.dropped[0]?.errors[0]?.includes('body_contains'),
      expected: true,
    })
  })

  await t.step('drops multiple invalid selections in one call', async () => {
    const query =
      '{ a: journals(where: {recent: "7d"}) { path } b: messages(where: {body_contains: "x"}) { path } c: documents(where: {madeUp: "y"}) { path } }'
    const result = await dropInvalidSelections(query)
    assert({
      given: 'two invalid selections among three',
      should: 'drop both and keep the survivor',
      actual: result?.dropped
        .map((d) => d.key)
        .sort()
        .join(','),
      expected: 'b,c',
    })
    assert({
      given: 'two invalid selections among three',
      should: 'leave a document that validates clean',
      actual: await graphQLValidationErrors(result?.query ?? ''),
      expected: null,
    })
  })

  await t.step('salvages the 2026-07-12 incident shape without normalization', async () => {
    // Raw form of the failure: `involves` misplaced beside `where`. Even
    // when the hoist repair is bypassed, salvage must confine the damage
    // to the one selection instead of voiding the document.
    const query = `query {
  msgs: messages(where: { involves: "Alice Hart" }, limit: 20) { path }
  docs: documents(where: { tagsStartsWith: "Acme/Talent" }, involves: "Alice Hart", limit: 10) { path }
  person: people(where: { nameContains: "Alice Hart" }, limit: 3) { path }
}`
    const result = await dropInvalidSelections(query)
    assert({
      given: 'the misplaced-involves incident shape',
      should: 'drop only the offending selection',
      actual: result?.dropped.map((d) => d.key).join(','),
      expected: 'docs',
    })
    assert({
      given: 'the misplaced-involves incident shape',
      should: 'leave the survivors executable',
      actual: await graphQLValidationErrors(result?.query ?? ''),
      expected: null,
    })
  })

  await t.step('returns null when every selection is invalid', async () => {
    assert({
      given: 'a document with no valid selections',
      should: 'return null instead of an empty query',
      actual: await dropInvalidSelections('{ documents(where: {madeUp: "x"}) { path } }'),
      expected: null,
    })
  })

  await t.step('returns null for unparseable input', async () => {
    assert({
      given: 'a non-GraphQL string',
      should: 'return null — there is nothing to salvage',
      actual: await dropInvalidSelections('{\nchanged:true}\n}'),
      expected: null,
    })
  })
})
