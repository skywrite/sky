/**
 * Tests for GraphQL query execution against DomainCollection.
 */

import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { executeQuery, isGraphQL } from './execute.ts'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockCollection(items: Array<{ doc: Document; path: string }>) {
  return {
    getAll: () => ({
      toArray: () => items,
    }),
  }
}

function createMockStore(): MarkdownStore {
  // Create a minimal mock store with test data
  const peopleData = [
    {
      doc: Document.fromMarkdown(`---
name: Alice Smith
org: Acme Corp
title: Engineer
tags: [Engineering]
---
Alice is an engineer.`),
      path: '/test/people/alice.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Bob Jones
org: MoonPay
title: Designer
tags: [Design]
---
Bob is a designer.`),
      path: '/test/people/bob.md',
    },
  ]

  const orgsData = [
    {
      doc: Document.fromMarkdown(`---
name: Acme Corp
sector: Technology
tags: [Organization/Company]
---
A tech company.`),
      path: '/test/orgs/acme.md',
    },
  ]

  const chatsData = [
    {
      doc: Document.fromMarkdown(`---
created: 2026-02-03
summary: Planning the Widget Launch
provider: claude
model: claude-opus-4-6
turns: 1
tags: Work
---

# Planning the Widget Launch

## JP

How should we plan the widget launch?

## AI Assistant

Start with a small beta group.`),
      path: '/test/time/2026/02/02-08/03/actions/ai-chats/09-15_Planning-the-Widget-Launch.md',
    },
    {
      doc: Document.fromMarkdown(`---
from: Alice Smith
to: Bob Jones
medium: Slack
summary: Widget launch sync
---
Alice to Bob about the widget launch.`),
      path: '/test/time/2026/02/02-08/04/actions/messages/slack_Alice-to-Bob_Widget-launch-sync.md',
    },
    {
      doc: Document.fromMarkdown(`---
from: Carol White
to: "#next-data"
medium: Slack
summary: Funnel metrics request
---
Posted in the next-data channel.`),
      path: '/test/time/2026/02/02-08/05/actions/messages/slack_Carol-to-next-data_Funnel-metrics-request.md',
    },
    {
      doc: Document.fromMarkdown(`---
from: Jane Doe
to: "#finance-updates"
medium: Loom
summary: Finance Weekly Update
tags: [Finance]
---
Weekly finance video.`),
      path: '/test/time/2026/02/02-08/05/actions/videos/Loom_Jane_Finance-Weekly-Update.md',
    },
  ]

  const store = {
    // people doubles as the PeopleStore for involves name resolution; the
    // empty index (names/find) makes resolution fall back to literal names
    people: { ...createMockCollection(peopleData), names: [], find: () => undefined },
    orgs: createMockCollection(orgsData),
    projects: { ...createMockCollection([]), getDocuments: () => ({ toArray: () => [] }) },
    decisions: createMockCollection([]),
    goals: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection([]),
    time: createMockCollection(chatsData),
  } as unknown as MarkdownStore

  return store
}

// =============================================================================
// isGraphQL Tests
// =============================================================================

const isGraphQLFixtures = [
  { input: '{ people { name } }', expected: true, desc: 'simple query' },
  { input: 'query { people { name } }', expected: true, desc: 'explicit query keyword' },
  { input: 'query{people{name}}', expected: true, desc: 'no spaces' },
  { input: '  { people { name } }', expected: true, desc: 'leading whitespace' },
  { input: 'meeting:recent(7d)', expected: false, desc: 'CSS selector' },
  { input: 'person[org=MoonPay]', expected: false, desc: 'CSS selector with attribute' },
  { input: '*[tags~=Work]', expected: false, desc: 'CSS selector with wildcard' },
]

for (const { input, expected, desc } of isGraphQLFixtures) {
  test(`isGraphQL - ${desc}`, () => {
    assert({
      given: `input "${input}"`,
      should: `return ${expected}`,
      actual: isGraphQL(input),
      expected,
    })
  })
}

// =============================================================================
// executeQuery Tests
// =============================================================================

test('executeQuery - returns people with requested fields', async () => {
  const store = createMockStore()
  const query = '{ people { name org path } }'

  const result = await executeQuery<{ people: Array<{ name: string; org: string; path: string }> }>(query, store)

  assert({
    given: 'a query for people with name, org, path',
    should: 'return people array with those fields',
    actual: result.errors,
    expected: undefined,
  })

  assert({
    given: 'a query for people',
    should: 'return 2 people',
    actual: result.data?.people.length,
    expected: 2,
  })

  assert({
    given: 'a query for people',
    should: 'include Alice',
    actual: result.data?.people.some((p) => p.name === 'Alice Smith'),
    expected: true,
  })
})

test('executeQuery - filters people by org', async () => {
  const store = createMockStore()
  const query = '{ people(where: { org: "MoonPay" }) { name org } }'

  const result = await executeQuery<{ people: Array<{ name: string; org: string }> }>(query, store)

  assert({
    given: 'a query for people at MoonPay',
    should: 'return only Bob',
    actual: result.data?.people.length,
    expected: 1,
  })

  assert({
    given: 'a query for people at MoonPay',
    should: 'return Bob Jones',
    actual: result.data?.people[0]?.name,
    expected: 'Bob Jones',
  })
})

test('executeQuery - respects limit', async () => {
  const store = createMockStore()
  const query = '{ people(limit: 1) { name } }'

  const result = await executeQuery<{ people: Array<{ name: string }> }>(query, store)

  assert({
    given: 'a query with limit 1',
    should: 'return only 1 person',
    actual: result.data?.people.length,
    expected: 1,
  })
})

test('executeQuery - returns orgs with derived kind', async () => {
  const store = createMockStore()
  const query = '{ orgs { name kind } }'

  const result = await executeQuery<{ orgs: Array<{ name: string; kind: string }> }>(query, store)

  assert({
    given: 'a query for orgs',
    should: 'return Acme Corp',
    actual: result.data?.orgs[0]?.name,
    expected: 'Acme Corp',
  })

  assert({
    given: 'an org with Organization/Company tag',
    should: 'derive kind as company',
    actual: result.data?.orgs[0]?.kind,
    expected: 'company',
  })
})

test('executeQuery - returns errors for invalid query', async () => {
  const store = createMockStore()
  const query = '{ invalidField }'

  const result = await executeQuery(query, store)

  assert({
    given: 'an invalid query',
    should: 'return errors',
    actual: result.errors !== undefined && result.errors.length > 0,
    expected: true,
  })
})

test('executeQuery - empty result for non-matching filter', async () => {
  const store = createMockStore()
  const query = '{ people(where: { org: "NonExistent" }) { name } }'

  const result = await executeQuery<{ people: Array<{ name: string }> }>(query, store)

  assert({
    given: 'a query with non-matching filter',
    should: 'return empty array',
    actual: result.data?.people.length,
    expected: 0,
  })
})

test('executeQuery - chats query works end-to-end against the schema', async () => {
  const store = createMockStore()
  const query = '{ chats(where: { bodyContains: "beta group" }) { date when summary provider turns markdown path } }'

  const result = await executeQuery<{
    chats: Array<{ date: string; when: string; summary: string; provider: string; turns: number; path: string }>
  }>(query, store)

  assert({
    given: 'a chats query with bodyContains',
    should: 'execute without schema errors',
    actual: result.errors,
    expected: undefined,
  })

  assert({
    given: 'a chats query with bodyContains',
    should: 'return the matching chat',
    actual: result.data?.chats.length,
    expected: 1,
  })

  assert({
    given: 'a chats query',
    should: 'map summary, when, and turns',
    actual: [result.data?.chats[0]?.summary, result.data?.chats[0]?.when, result.data?.chats[0]?.turns],
    expected: ['Planning the Widget Launch', '09:15', 1],
  })
})

test('executeQuery - chats are included in tag queries', async () => {
  const store = createMockStore()

  const chatResult = await executeQuery<{ chats: Array<{ summary: string; tags: string[] }> }>(
    '{ chats(where: { tagsContains: "Work" }) { summary tags } }',
    store,
  )

  assert({
    given: 'a chats query filtering by tag',
    should: 'execute without schema errors',
    actual: chatResult.errors,
    expected: undefined,
  })

  assert({
    given: 'a chats query filtering by tag',
    should: 'return the tagged chat with its tags',
    actual: [chatResult.data?.chats[0]?.summary, chatResult.data?.chats[0]?.tags],
    expected: ['Planning the Widget Launch', ['Work']],
  })

  const docResult = await executeQuery<{ documents: Array<{ type: string; path: string }> }>(
    '{ documents(where: { tagsContains: "Work" }) { type path } }',
    store,
  )

  assert({
    given: 'a cross-type documents query filtering by tag',
    should: 'include the chat, typed as chat',
    actual: docResult.data?.documents.filter((d) => d.path.includes('/ai-chats/')).map((d) => d.type),
    expected: ['chat'],
  })
})

test('executeQuery - involvesAny and involvesAll work end-to-end against the schema', async () => {
  const store = createMockStore()

  const anyResult = await executeQuery<{ messages: Array<{ path: string }> }>(
    '{ messages(where: { involvesAny: ["Alice Smith", "Carol Quinn"] }) { path } }',
    store,
  )

  assert({
    given: 'an involvesAny query where one listed person participates',
    should: 'execute without schema errors',
    actual: anyResult.errors,
    expected: undefined,
  })

  assert({
    given: 'an involvesAny query where one listed person participates',
    should: 'return the message (OR semantics)',
    actual: anyResult.data?.messages.length,
    expected: 1,
  })

  const allHit = await executeQuery<{ messages: Array<{ path: string }> }>(
    '{ messages(where: { involvesAll: ["Alice Smith", "Bob Jones"] }) { path } }',
    store,
  )

  assert({
    given: 'an involvesAll query where every listed person participates',
    should: 'return the mutual message (AND semantics)',
    actual: allHit.data?.messages.length,
    expected: 1,
  })

  const allMiss = await executeQuery<{ messages: Array<{ path: string }> }>(
    '{ messages(where: { involvesAll: ["Alice Smith", "Carol Quinn"] }) { path } }',
    store,
  )

  assert({
    given: 'an involvesAll query where one listed person is absent',
    should: 'return no messages',
    actual: allMiss.data?.messages.length,
    expected: 0,
  })
})

test('executeQuery - toContains filters channel messages and videos', async () => {
  const store = createMockStore()

  const msgHit = await executeQuery<{ messages: Array<{ to: string }> }>(
    '{ messages(where: { toContains: "#next-data" }) { to } }',
    store,
  )

  assert({
    given: 'a messages query filtering to a Slack channel',
    should: 'return only the channel message',
    actual: [msgHit.data?.messages.length, msgHit.data?.messages[0]?.to],
    expected: [1, '#next-data'],
  })

  const videoHit = await executeQuery<{ videos: Array<{ to: string }> }>(
    '{ videos(where: { toContains: "#finance-updates" }) { to } }',
    store,
  )

  assert({
    given: 'a videos query filtering to a Slack channel',
    should: 'return only the channel video',
    actual: [videoHit.data?.videos.length, videoHit.data?.videos[0]?.to],
    expected: [1, '#finance-updates'],
  })

  const videoMiss = await executeQuery<{ videos: Array<{ to: string }> }>(
    '{ videos(where: { toNotContains: "#finance-updates" }) { to } }',
    store,
  )

  assert({
    given: 'a videos query excluding the channel',
    should: 'return no videos',
    actual: videoMiss.data?.videos.length,
    expected: 0,
  })
})

test('executeQuery - resolver cache follows store mutations via version bumps', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: ['/nb/people'],
    orgDirs: ['/nb/orgs'],
    timeDirs: ['/nb/time'],
  })
  store.set('/nb/people/jane.md', '---\nname: Jane Doe\n---\n\nJane.')

  const before = await executeQuery<{ people: Array<{ path: string }> }>('{ people { path } }', store)

  store.delete('/nb/people/jane.md')

  const after = await executeQuery<{ people: Array<{ path: string }> }>('{ people { path } }', store)

  assert({
    given: 'a person set on the store',
    should: 'appear in query results',
    actual: before.data?.people.map((p) => p.path),
    expected: ['/nb/people/jane.md'],
  })

  assert({
    given: 'the person deleted after a cached query',
    should: 'disappear from the next query without any manual cache reset',
    actual: after.data?.people,
    expected: [],
  })
})
