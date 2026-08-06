/**
 * Tests for DomainCollection GraphQL resolvers.
 */

import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { docToMeeting } from './resolvers/meeting.ts'
import { createDomainResolvers } from './resolvers/mod.ts'
import { DEFAULT_QUERY_LIMIT } from './resolvers/shared.ts'

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
  const meetingsData = [
    {
      doc: Document.fromMarkdown(`---
who: Alice, Bob
when: 2026-02-01 14:00 - 15:00
medium: Zoom
date: "2026-02-01"
summary: Project kickoff
tags: [Work]
---
Meeting notes here.`),
      path: '/test/time/2026/01/26-01/01-01/actions/meetings/meeting1.md',
    },
    {
      doc: Document.fromMarkdown(`---
who: Charlie
when: 2026-01-28 10:00
medium: Phone
date: "2026-01-28"
summary: Quick sync
tags: [Personal]
---
Phone call notes.`),
      path: '/test/time/2026/01/26-01/01-28/actions/meetings/meeting2.md',
    },
  ]

  // Message with created date (2026-02-18) different from path date (2026-02-05)
  const messagesData = [
    {
      doc: Document.fromMarkdown(`---
from: Tanisha
to: JP
when: 2026-01-28 18:18
medium: Slack
summary: M&A candidate
created: 2026-02-18
---
Old message saved later.`),
      path: '/test/time/2026/02/02-08/02-05/actions/messages/old-message.md',
    },
    {
      doc: Document.fromMarkdown(`---
from: Kevin
to: JP
when: 2026-01-28 09:00
medium: Slack
summary: Status update
created: 2026-02-17
---
Recent message.`),
      path: '/test/time/2026/02/16-22/02-17/actions/messages/recent-message.md',
    },
  ]

  const peopleData = [
    {
      doc: Document.fromMarkdown(`---
name: Alice Smith
org: Acme Corp
title: Engineer
tags: [Engineering]
rel: [Bob Jones]
---
Alice is an engineer.`),
      path: '/test/people/alice.md',
    },
  ]

  const decisionsData = [
    {
      doc: Document.fromMarkdown(`---
name: hire-designer
summary: Hire a new designer
identified: "2026-01-15"
target: "2026-02-01"
tags: [Hiring]
---
Decision details.`),
      path: '/test/decisions/hire-designer.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: new-office
summary: Move to new office
identified: "2026-01-10"
resolved: "2026-01-25"
decided: "2026-01-25"
tags: [Operations]
---
Decided to move.`),
      path: '/test/decisions/new-office.md',
    },
  ]

  const projectsData = [
    {
      doc: Document.fromMarkdown(`---
name: Acme Pay GTM
status: open
created: 2020-05-01
tags: [Sample/Sales]
rel: [decisions/Hire-CTO, people/Jane-Doe]
---
Go-to-market plan.`),
      path: '/test/projects/open/Acme-Pay-GTM/_project/overview.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Website Refresh
status: open
updated: 2026-03-01
tags: [Sample/Web]
---
Refresh the marketing site.`),
      path: '/test/projects/open/Website-Refresh/_project/overview.md',
    },
  ]

  const ideasData = [
    {
      doc: Document.fromMarkdown(`---
name: Crypto-Debit-Rewards
created: 2026-02-08
tags: [Sample/Ideas]
---
Reward debit purchases in BTC.`),
      path: '/test/ideas/Crypto-Debit-Rewards.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Legacy-Widget
tags: [Sample/Ideas]
---
Old undated idea.`),
      path: '/test/ideas/Legacy-Widget.md',
    },
  ]

  const chatsData = [
    {
      doc: Document.fromMarkdown(`---
created: 2026-02-03
updated: 2026-02-03
summary: Planning the Widget Launch
provider: claude
model: claude-opus-4-6
turns: 2
tags: Work
---

# Planning the Widget Launch

## JP

How should we plan the widget launch?

## AI Assistant

Start with a small beta group.`),
      path: '/test/time/2026/02/02-08/02-03/actions/ai-chats/09-15_Planning-the-Widget-Launch.md',
    },
    {
      doc: Document.fromMarkdown(`---
created: 2026-01-27
summary: Brainstorm Marketing Ideas
provider: claude
model: claude-haiku-4-5
turns: 1
tags: Acme/Marketing/Ideas; Acme/Company
---

# Brainstorm Marketing Ideas

## JP

Give me marketing ideas.

## AI Assistant

Here are three angles to consider.`),
      path: '/test/time/2026/01/26-01/01-27/actions/ai-chats/18-42_Brainstorm-Marketing-Ideas.md',
    },
  ]

  const placesData = [
    {
      doc: Document.fromMarkdown(`---
name: Don Julio
type: eat
address: Guatemala 4699, Buenos Aires
site: https://donjulio.com
googleMapsUrl: https://maps.google.com/?q=Don+Julio
location:
  country: AR
  city: Buenos Aires
tags: [Restaurant, Steak]
---
Famous steakhouse in Palermo.`),
      path: '/test/places/AR/Buenos-Aires/eat/Don-Julio.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Ty Bar
type: drink
address: 2 E 55th St, New York
location:
  country: US
  region: NY
  city: New York
  subcity: Manhattan
tags: [Bar, Cocktails]
---
Classic cocktail bar.`),
      path: '/test/places/US/NY/New-York/Manhattan/drink/Ty-Bar.md',
    },
  ]

  // Folder files arrive from ProjectStore with the project rel already
  // injected — mimic that here (injection itself is ProjectStore-tested)
  const projectFilesData = [
    {
      doc: Document.fromMarkdown(`---
rel: [projects/Acme Pay GTM]
---
GTM launch checklist.`),
      path: '/test/projects/open/Acme-Pay-GTM/checklist.md',
    },
  ]

  return {
    people: createMockCollection(peopleData),
    orgs: createMockCollection([]),
    projects: {
      ...createMockCollection(projectsData),
      getDocuments: () => ({ toArray: () => projectFilesData }),
    },
    decisions: createMockCollection(decisionsData),
    goals: createMockCollection([]),
    streaks: createMockCollection([]),
    ideas: createMockCollection(ideasData),
    places: createMockCollection(placesData),
    time: createMockCollection([...meetingsData, ...messagesData, ...chatsData]),
  } as unknown as MarkdownStore
}

// =============================================================================
// Resolver Tests
// =============================================================================

test('resolvers - meetings returns all meetings', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})

  assert({
    given: 'no filter',
    should: 'return all meetings',
    actual: result.length,
    expected: 2,
  })
})

test('resolvers - meetings filters by whoContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({ where: { whoContains: 'Alice' } })

  assert({
    given: 'whoContains filter for Alice',
    should: 'return 1 meeting',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'whoContains filter for Alice',
    should: 'return meeting with Alice',
    actual: result[0]?.who.includes('Alice'),
    expected: true,
  })
})

test('resolvers - meetings respects limit', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({ limit: 1 })

  assert({
    given: 'limit of 1',
    should: 'return 1 meeting',
    actual: result.length,
    expected: 1,
  })
})

test('resolvers - people includes rel as array', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.people({})

  assert({
    given: 'a person with rel field',
    should: 'include rel as array',
    actual: Array.isArray(result[0]?.rel),
    expected: true,
  })

  assert({
    given: 'a person with rel field',
    should: 'contain related person',
    actual: result[0]?.rel.includes('Bob Jones'),
    expected: true,
  })
})

test('resolvers - decisions pending filter', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const pending = resolvers.decisions({ where: { pending: true } })
  const decided = resolvers.decisions({ where: { decided: true } })

  assert({
    given: 'pending filter',
    should: 'return 1 pending decision',
    actual: pending.length,
    expected: 1,
  })

  assert({
    given: 'pending filter',
    should: 'return hire-designer',
    actual: pending[0]?.name,
    expected: 'hire-designer',
  })

  assert({
    given: 'decided filter',
    should: 'return 1 decided decision',
    actual: decided.length,
    expected: 1,
  })

  assert({
    given: 'decided filter',
    should: 'return new-office',
    actual: decided[0]?.name,
    expected: 'new-office',
  })
})

test('resolvers - decisions isPending computed correctly', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const all = resolvers.decisions({})
  const pendingDecision = all.find((d) => d.name === 'hire-designer')
  const decidedDecision = all.find((d) => d.name === 'new-office')

  assert({
    given: 'a pending decision',
    should: 'have isPending true',
    actual: pendingDecision?.isPending,
    expected: true,
  })

  assert({
    given: 'a decided decision',
    should: 'have isPending false',
    actual: decidedDecision?.isPending,
    expected: false,
  })
})

test('resolvers - meetings includes path', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})

  assert({
    given: 'a meeting',
    should: 'include path',
    actual: result[0]?.path.endsWith('.md'),
    expected: true,
  })
})

test('resolvers - meetings includes markdown', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})

  assert({
    given: 'a meeting',
    should: 'include markdown content',
    actual: result[0]?.markdown.includes('Meeting notes'),
    expected: true,
  })
})

// =============================================================================
// Places Resolver Tests
// =============================================================================

test('resolvers - places returns all places', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({})

  assert({
    given: 'no filter',
    should: 'return all places',
    actual: result.length,
    expected: 2,
  })
})

test('resolvers - places maps fields correctly', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({})
  const donJulio = result.find((p) => p.name === 'Don Julio')

  assert({
    given: 'a place with all fields',
    should: 'map name',
    actual: donJulio?.name,
    expected: 'Don Julio',
  })

  assert({
    given: 'a place with all fields',
    should: 'map type',
    actual: donJulio?.type,
    expected: 'eat',
  })

  assert({
    given: 'a place with all fields',
    should: 'map address',
    actual: donJulio?.address,
    expected: 'Guatemala 4699, Buenos Aires',
  })

  assert({
    given: 'a place with location.country',
    should: 'extract country from nested location',
    actual: donJulio?.country,
    expected: 'AR',
  })

  assert({
    given: 'a place with location.city',
    should: 'extract city from nested location',
    actual: donJulio?.city,
    expected: 'Buenos Aires',
  })
})

test('resolvers - places filters by country', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { country: 'AR' } })

  assert({
    given: 'country filter for AR',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'country filter for AR',
    should: 'return Don Julio',
    actual: result[0]?.name,
    expected: 'Don Julio',
  })
})

test('resolvers - places filters by type', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { type: 'drink' } })

  assert({
    given: 'type filter for drink',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'type filter for drink',
    should: 'return Ty Bar',
    actual: result[0]?.name,
    expected: 'Ty Bar',
  })
})

test('resolvers - places filters by cityContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { cityContains: 'Buenos' } })

  assert({
    given: 'cityContains filter for Buenos',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })
})

test('resolvers - places filters by nameContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { nameContains: 'Ty' } })

  assert({
    given: 'nameContains filter for Ty',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'nameContains filter for Ty',
    should: 'return Ty Bar',
    actual: result[0]?.name,
    expected: 'Ty Bar',
  })
})

test('resolvers - places respects limit', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ limit: 1 })

  assert({
    given: 'limit of 1',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })
})

// =============================================================================
// Date filtering uses path date, not created date
// =============================================================================

test('resolvers - messages date filter uses path date, not created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // Filter for Feb 16-18 range — old message has created: 2026-02-18 but path date is Feb 5
  const result = resolvers.messages({ where: { dateGte: '2026-02-16', dateLte: '2026-02-18' } })

  assert({
    given: 'date range 2026-02-16 to 2026-02-18',
    should: 'return only the message whose path date is in range',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'date range 2026-02-16 to 2026-02-18',
    should: 'return the Feb 17 message, not the Feb 5 message with created: Feb 18',
    actual: result[0]?.from,
    expected: 'Kevin',
  })
})

test('resolvers - messages date filter excludes old path despite recent created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // Filter for Feb 5 — should find the old message by its path date
  const result = resolvers.messages({ where: { dateGte: '2026-02-05', dateLte: '2026-02-05' } })

  assert({
    given: 'date range for Feb 5 only',
    should: 'find message by path date even though created is Feb 18',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'date range for Feb 5 only',
    should: 'return the Tanisha message',
    actual: result[0]?.from,
    expected: 'Tanisha',
  })
})

test('resolvers - documents date filter uses path date, not created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // The documents resolver returns all types — filter to Feb 16-18
  const result = resolvers.documents({ where: { dateGte: '2026-02-16', dateLte: '2026-02-18' } })
  const messagePaths = result.map((d) => d.path).filter((p) => p.includes('/messages/'))

  assert({
    given: 'documents query for Feb 16-18',
    should: 'not include the Feb 5 message (even though created is Feb 18)',
    actual: messagePaths.some((p) => p.includes('old-message')),
    expected: false,
  })

  assert({
    given: 'documents query for Feb 16-18',
    should: 'include the Feb 17 message',
    actual: messagePaths.some((p) => p.includes('recent-message')),
    expected: true,
  })
})

test('resolvers - meetings date filter uses path date over created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // Meeting1 has date: 2026-02-01 (YAML), path is Jan 26-01/01
  // Meeting2 has date: 2026-01-28 (YAML), path is Jan 26-01/28
  // YAML date field still takes priority over path
  const result = resolvers.meetings({ where: { dateGte: '2026-02-01', dateLte: '2026-02-01' } })

  assert({
    given: 'date filter for Feb 1 — meeting has YAML date: 2026-02-01',
    should: 'use YAML date field (highest priority)',
    actual: result.length,
    expected: 1,
  })
})

test('resolvers - chats returns only ai-chat documents', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({})

  assert({
    given: 'no filter',
    should: 'return both chats and nothing else from the time store',
    actual: result.length,
    expected: 2,
  })

  assert({
    given: 'no filter',
    should: 'only include ai-chats paths',
    actual: result.every((c) => c.path.includes('/ai-chats/')),
    expected: true,
  })
})

test('resolvers - chats filters by summaryContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({ where: { summaryContains: 'widget' } })

  assert({
    given: 'summaryContains filter for widget',
    should: 'return 1 chat',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'summaryContains filter for widget',
    should: 'return the widget launch chat',
    actual: result[0]?.summary,
    expected: 'Planning the Widget Launch',
  })
})

test('resolvers - chats filters by bodyContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({ where: { bodyContains: 'beta group' } })

  assert({
    given: 'bodyContains filter matching transcript text',
    should: 'return the chat whose conversation mentions it',
    actual: result.length,
    expected: 1,
  })
})

test('resolvers - chats maps fields correctly', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({ where: { summaryContains: 'widget' } })
  const chat = result[0]

  assert({
    given: 'a chat document',
    should: 'derive when from the HH-MM filename prefix',
    actual: chat?.when,
    expected: '09:15',
  })

  assert({
    given: 'a chat document',
    should: 'derive date from the day path',
    actual: chat?.date,
    expected: '2026-02-03',
  })

  assert({
    given: 'a chat document',
    should: 'map provider from YAML',
    actual: chat?.provider,
    expected: 'claude',
  })

  assert({
    given: 'a chat document',
    should: 'map turns from YAML',
    actual: chat?.turns,
    expected: 2,
  })
})

test('resolvers - chats sorted by date descending', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({})

  assert({
    given: 'two chats from different days',
    should: 'return the most recent first',
    actual: result[0]?.date,
    expected: '2026-02-03',
  })
})

test('resolvers - chats filters by tagsContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({ where: { tagsContains: 'Work' } })

  assert({
    given: 'tagsContains filter for Work',
    should: 'return only the tagged chat',
    actual: result.map((c) => c.summary),
    expected: ['Planning the Widget Launch'],
  })
})

test('resolvers - chats filters by hierarchical tagsStartsWith', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.chats({ where: { tagsStartsWith: 'Acme/Marketing/' } })

  assert({
    given: 'tagsStartsWith filter for the Acme/Marketing/ prefix',
    should: 'return the chat tagged Acme/Marketing/Ideas',
    actual: result.map((c) => c.summary),
    expected: ['Brainstorm Marketing Ideas'],
  })

  assert({
    given: 'a chat with semicolon-delimited tags',
    should: 'parse both tags',
    actual: result[0]?.tags,
    expected: ['Acme/Marketing/Ideas', 'Acme/Company'],
  })
})

test('resolvers - documents tag queries include chats', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.documents({ where: { tagsContains: 'Work' } })
  const paths = result.map((d) => d.path)

  assert({
    given: 'a cross-type documents query filtering by tag Work',
    should: 'include the tagged chat',
    actual: paths.some((p) => p.includes('/ai-chats/')),
    expected: true,
  })

  assert({
    given: 'a cross-type documents query filtering by tag Work',
    should: 'report the chat with type chat',
    actual: result.find((d) => d.path.includes('/ai-chats/'))?.type,
    expected: 'chat',
  })
})

test('resolvers - chats do not appear in meetings or messages', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const meetings = resolvers.meetings({})
  const messages = resolvers.messages({})

  assert({
    given: 'chats in the time store',
    should: 'not leak into meetings',
    actual: meetings.some((m) => m.path.includes('/ai-chats/')),
    expected: false,
  })

  assert({
    given: 'chats in the time store',
    should: 'not leak into messages',
    actual: messages.some((m) => m.path.includes('/ai-chats/')),
    expected: false,
  })
})

// =============================================================================
// relContains on entity types
// =============================================================================

test('resolvers - projects filters by relContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({ where: { relContains: 'hire-cto' } })

  assert({
    given: 'relContains filter matching a linked decision (case-insensitive)',
    should: 'return only the project carrying that rel link',
    actual: result.map((p) => p.name),
    expected: ['Acme Pay GTM'],
  })
})

test('resolvers - documents relContains finds project folder files', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.documents({ where: { relContains: 'Acme Pay GTM' } })

  assert({
    given: 'a project-name relContains filter on the documents root',
    should: 'return the folder file carrying the injected rel',
    actual: result.map((d: { path: string }) => d.path),
    expected: ['/test/projects/open/Acme-Pay-GTM/checklist.md'],
  })
})

test('resolvers - projects root excludes project folder files', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({})

  assert({
    given: 'a store with two overviews and one folder file',
    should: 'return only the overviews',
    actual: result.map((p) => p.name).sort(),
    expected: ['Acme Pay GTM', 'Website Refresh'],
  })
})

test('resolvers - projects expose folder files via files', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({})
  const byName = new Map(result.map((p) => [p.name, p.files]))

  assert({
    given: 'a project with one folder file',
    should: 'list the file path in files',
    actual: byName.get('Acme Pay GTM'),
    expected: ['/test/projects/open/Acme-Pay-GTM/checklist.md'],
  })

  assert({
    given: 'a project with no folder files',
    should: 'return an empty files list',
    actual: byName.get('Website Refresh'),
    expected: [],
  })
})

test('resolvers - projects relContains with no match returns empty', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({ where: { relContains: 'Unrelated-Thing' } })

  assert({
    given: 'relContains filter matching no rel links',
    should: 'return no projects',
    actual: result.length,
    expected: 0,
  })
})

test('resolvers - people filters by relContains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.people({ where: { relContains: 'Bob Jones' } })

  assert({
    given: 'relContains filter matching a related person',
    should: 'return the linked person',
    actual: result.map((p) => p.name),
    expected: ['Alice Smith'],
  })
})

// =============================================================================
// recent on entity types
// =============================================================================

test('resolvers - ideas filters by recent using created date', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.ideas({ where: { recent: '100y' } })

  assert({
    given: 'recent window spanning the created date',
    should: 'return only the idea carrying a created date',
    actual: result.map((i) => i.name),
    expected: ['Crypto-Debit-Rewards'],
  })
})

test('resolvers - projects recent excludes docs outside the window', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({ where: { recent: '1d' } })

  assert({
    given: 'recent window that predates every created date',
    should: 'return no projects',
    actual: result.length,
    expected: 0,
  })
})

test('resolvers - decisions filters by recent using identified date', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.decisions({ where: { recent: '100y' } })

  assert({
    given: 'recent window spanning identified dates',
    should: 'return decisions dated via the identified fallback',
    actual: result.map((d) => d.name).sort(),
    expected: ['hire-designer', 'new-office'],
  })
})

test('resolvers - entity recent blends updated and created activity', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({ where: { recent: '100y' } })

  assert({
    given: 'one project dated via created, the other via updated',
    should: 'return both through the activity blend',
    actual: result.map((p) => p.name).sort(),
    expected: ['Acme Pay GTM', 'Website Refresh'],
  })
})

test('resolvers - createdRecently matches only documents with a created date', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({ where: { createdRecently: '100y' } })

  assert({
    given: 'a strict createdRecently window',
    should: 'exclude the project that only has an updated date',
    actual: result.map((p) => p.name),
    expected: ['Acme Pay GTM'],
  })
})

test('resolvers - updatedRecently matches only documents with an updated date', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.projects({ where: { updatedRecently: '100y' } })

  assert({
    given: 'a strict updatedRecently window',
    should: 'exclude the project that only has a created date',
    actual: result.map((p) => p.name),
    expected: ['Website Refresh'],
  })
})

// =============================================================================
// bodyContains on entity types
// =============================================================================

test('resolvers - ideas filters by bodyContains case-insensitively', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.ideas({ where: { bodyContains: 'btc' } })

  assert({
    given: 'bodyContains matching an idea body in a different case',
    should: 'return only the matching idea',
    actual: result.map((i) => i.name),
    expected: ['Crypto-Debit-Rewards'],
  })
})

test('resolvers - people bodyContains excludes non-matching bodies', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.people({ where: { bodyContains: 'no-such-phrase' } })

  assert({
    given: 'bodyContains matching no person body',
    should: 'return no people',
    actual: result.length,
    expected: 0,
  })
})

// =============================================================================
// videos
//
// A local store rather than createMockStore(), so adding video fixtures cannot
// shift the counts the shared time-collection tests above assert on.
// =============================================================================

function createVideoStore(): MarkdownStore {
  const videosData = [
    {
      doc: Document.fromMarkdown(`---
from: Jane Doe
to: "#engineering"
when: 2026-01-28 09:46
medium: Loom
summary: Weekly product update
video:
  url: https://example.com/v/abc123
---
Transcript mentions the Atlas rollout.`),
      path: '/test/time/2026/02/02-08/02-03/actions/videos/update.md',
    },
    {
      doc: Document.fromMarkdown(`---
from: John Smith
to: Atlas Team
when: 2026-01-28 11:00
medium: YouTube
summary: Conference talk
---
Talk notes.`),
      path: '/test/time/2026/02/02-08/02-04/actions/videos/talk.md',
    },
  ]

  return {
    people: createMockCollection([]),
    orgs: createMockCollection([]),
    projects: { ...createMockCollection([]), getDocuments: () => ({ toArray: () => [] }) },
    decisions: createMockCollection([]),
    goals: createMockCollection([]),
    streaks: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection([]),
    time: createMockCollection(videosData),
  } as unknown as MarkdownStore
}

test('resolvers - videos returns all videos', () => {
  const resolvers = createDomainResolvers(createVideoStore())

  assert({
    given: 'no filter',
    should: 'return every video',
    actual: resolvers.videos({}).length,
    expected: 2,
  })
})

test('resolvers - videos maps the nested video.url field', () => {
  const resolvers = createDomainResolvers(createVideoStore())

  const result = resolvers.videos({ where: { from: 'Jane Doe' } })

  assert({
    given: 'a video with video.url set',
    should: 'flatten it to the url field',
    actual: result[0]?.url,
    expected: 'https://example.com/v/abc123',
  })

  assert({
    given: 'a video with no video key at all',
    should: 'report url as null',
    actual: resolvers.videos({ where: { from: 'John Smith' } })[0]?.url,
    expected: null,
  })
})

test('resolvers - videos filters by exact from', () => {
  const resolvers = createDomainResolvers(createVideoStore())

  assert({
    given: 'an exact from filter',
    should: 'return only that presenter',
    actual: resolvers.videos({ where: { from: 'Jane Doe' } }).map((v) => v.path),
    expected: ['/test/time/2026/02/02-08/02-03/actions/videos/update.md'],
  })

  assert({
    given: 'a partial name under the exact from filter',
    should: 'not match — exact means exact, unlike fromContains',
    actual: resolvers.videos({ where: { from: 'Jane' } }).length,
    expected: 0,
  })

  assert({
    given: 'the same partial name under fromContains',
    should: 'still match',
    actual: resolvers.videos({ where: { fromContains: 'Jane' } }).length,
    expected: 1,
  })
})

test('resolvers - videos filters by fromNot', () => {
  const resolvers = createDomainResolvers(createVideoStore())

  assert({
    given: 'a fromNot filter',
    should: 'exclude that presenter and keep the rest',
    actual: resolvers.videos({ where: { fromNot: 'Jane Doe' } }).map((v) => v.from),
    expected: ['John Smith'],
  })
})

test('resolvers - videos filters by exact to', () => {
  const resolvers = createDomainResolvers(createVideoStore())

  assert({
    given: 'an exact to filter for a channel audience',
    should: 'return the video posted to that channel',
    actual: resolvers.videos({ where: { to: '#engineering' } }).map((v) => v.from),
    expected: ['Jane Doe'],
  })

  assert({
    given: 'an exact to filter for a named audience',
    should: 'return the video sent to that audience',
    actual: resolvers.videos({ where: { to: 'Atlas Team' } }).map((v) => v.from),
    expected: ['John Smith'],
  })
})

test('resolvers - videos filters by toNot', () => {
  const resolvers = createDomainResolvers(createVideoStore())

  assert({
    given: 'a toNot filter',
    should: 'exclude that audience and keep the rest',
    actual: resolvers.videos({ where: { toNot: '#engineering' } }).map((v) => v.from),
    expected: ['John Smith'],
  })
})

// =============================================================================
// Sort-before-limit and the default limit
// =============================================================================

/** A store whose time collection holds exactly the given items. */
function createTimeStore(items: Array<{ doc: Document; path: string }>): MarkdownStore {
  return {
    people: createMockCollection([]),
    orgs: createMockCollection([]),
    projects: { ...createMockCollection([]), getDocuments: () => ({ toArray: () => [] }) },
    decisions: createMockCollection([]),
    goals: createMockCollection([]),
    streaks: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection([]),
    time: createMockCollection(items),
  } as unknown as MarkdownStore
}

test('resolvers - documents sorts newest-first before applying limit', () => {
  // Store order is oldest path first — the order that used to reach `limit`
  const resolvers = createDomainResolvers(
    createTimeStore([
      {
        doc: Document.fromMarkdown('# Old video\n'),
        path: '/test/time/2022/03/07-13/03-09/actions/videos/old-video.md',
      },
      {
        doc: Document.fromMarkdown('# Mid note\n'),
        path: '/test/time/2025/05/05-11/05-07/actions/notes/mid-note.md',
      },
      {
        doc: Document.fromMarkdown('# New script\n'),
        path: '/test/time/2026/03/09-15/03-11/actions/notes/new-script.md',
      },
    ]),
  )

  assert({
    given: 'three dated documents and limit 2',
    should: 'keep the two newest, not the first two in store order',
    actual: resolvers.documents({ limit: 2 }).map((d) => d.path),
    expected: [
      '/test/time/2026/03/09-15/03-11/actions/notes/new-script.md',
      '/test/time/2025/05/05-11/05-07/actions/notes/mid-note.md',
    ],
  })
})

test('resolvers - documents sinks undated files below dated ones', () => {
  const resolvers = createDomainResolvers(
    createTimeStore([
      { doc: Document.fromMarkdown('# Undated\n'), path: '/test/notes/reference.md' },
      {
        doc: Document.fromMarkdown('# Dated\n'),
        path: '/test/time/2026/01/05-11/01-05/actions/notes/dated.md',
      },
    ]),
  )

  assert({
    given: 'a dated and an undated document',
    should: 'order the dated one first',
    actual: resolvers.documents({}).map((d) => d.path),
    expected: ['/test/time/2026/01/05-11/01-05/actions/notes/dated.md', '/test/notes/reference.md'],
  })
})

test('resolvers - a query without limit is capped at DEFAULT_QUERY_LIMIT', () => {
  const many = Array.from({ length: DEFAULT_QUERY_LIMIT + 10 }, (_, i) => ({
    doc: Document.fromMarkdown(`# Note ${i}\n`),
    path: `/test/time/2026/01/05-11/01-05/actions/notes/note-${i}.md`,
  }))
  const resolvers = createDomainResolvers(createTimeStore(many))

  assert({
    given: `${DEFAULT_QUERY_LIMIT + 10} documents and no limit argument`,
    should: 'return at most the default cap',
    actual: resolvers.documents({}).length,
    expected: DEFAULT_QUERY_LIMIT,
  })

  assert({
    given: 'an explicit limit above the default cap',
    should: 'honor the explicit limit',
    actual: resolvers.documents({ limit: DEFAULT_QUERY_LIMIT + 10 }).length,
    expected: DEFAULT_QUERY_LIMIT + 10,
  })
})

// The when: mapping had no coverage at all: getWhenField swallows a value it
// cannot read and returns null, so a broken mapping would have looked like a
// passing suite rather than a failure.
const MEETING_PATH = '/test/time/2026/02/02-08/02-01/actions/meetings/x.md'

test('docToMeeting maps when to its structured shape', () => {
  const doc = Document.fromMarkdown(`---
who: Alice, Bob
when: 2026-02-01 14:00 - 15:00
medium: Zoom
---
Notes.`)

  assert({
    given: 'a meeting written as a range',
    should: 'expose datetime, derived duration and derived end',
    actual: JSON.stringify(docToMeeting(doc, MEETING_PATH).when),
    expected: JSON.stringify({
      datetime: '2026-02-01 14:00',
      duration: '60m',
      durationMinutes: 60,
      end: '2026-02-01 15:00',
    }),
  })
})

test('docToMeeting maps an unreadable when to null rather than throwing', () => {
  const doc = Document.fromMarkdown(`---
who: Dana
when:
medium: Zoom
---
No time was ever recorded.`)

  assert({
    given: 'a document whose when: records no time',
    should: 'yield null instead of failing the whole query',
    actual: docToMeeting(doc, MEETING_PATH).when,
    expected: null,
  })
})
