import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { Store } from '../store.ts'
import { createYogaInstance } from './schema.ts'

/**
 * Execution smoke test for the service GraphQL layer.
 *
 * schema_test.ts guards resolver *presence*; this guards resolver *behavior*:
 * every DomainCollection root field is executed through the real yoga
 * instance with a discriminating filter that only returns the expected row
 * when args arrive in the right parameter position. DC resolvers take
 * (args) root-value style while createSchema passes (parent, args) — the
 * delegates in schema.ts adapt between them. If that adaptation is ever
 * miswired (args read from the parent slot, or dropped entirely so filters
 * are ignored), these assertions fail even though the resolver exists.
 */

// =============================================================================
// Fixture store — two docs per type; each case's filter must select exactly one
// =============================================================================

function doc(markdown: string): Document {
  return Document.fromMarkdown(markdown)
}

function createMockCollection(items: Array<{ doc: Document; path: string }>) {
  return {
    getAll: () => ({
      toArray: () => items,
    }),
  }
}

const meetings = [
  {
    doc: doc(`---
who: Alice, Bob
when: "14:00"
medium: Zoom
date: "2026-02-01"
summary: Project kickoff
tags: [Work]
---
Meeting notes here.`),
    path: '/test/time/2026/02/02-08/02-03/actions/meetings/kickoff.md',
  },
  {
    doc: doc(`---
who: Charlie
when: "10:00"
medium: Phone
date: "2026-02-02"
summary: Quick sync
tags: [Personal]
---
Phone call notes.`),
    path: '/test/time/2026/02/02-08/02-03/actions/meetings/sync.md',
  },
]

const messages = [
  {
    doc: doc(`---
from: Kevin
to: JP
when: "09:00"
medium: Slack
summary: Status update
created: 2026-02-03
---
Recent message.`),
    path: '/test/time/2026/02/02-08/02-03/actions/messages/status.md',
  },
  {
    doc: doc(`---
from: Tanisha
to: JP
when: "18:18"
medium: Slack
summary: Candidate intro
created: 2026-02-03
---
Another message.`),
    path: '/test/time/2026/02/02-08/02-03/actions/messages/intro.md',
  },
]

const videos = [
  {
    doc: doc(`---
from: TechChannel
when: "20:00"
medium: Video
summary: Conference talk
created: 2026-02-03
---
Talk notes.`),
    path: '/test/time/2026/02/02-08/02-03/actions/videos/talk.md',
  },
  {
    doc: doc(`---
from: CookingShow
when: "21:00"
medium: Video
summary: Recipe walkthrough
created: 2026-02-03
---
Recipe notes.`),
    path: '/test/time/2026/02/02-08/02-03/actions/videos/recipe.md',
  },
]

const journals = [
  {
    doc: doc(`---
time: "08:00"
tags: [Journal]
---
Morning gratitude entry about the launch.`),
    path: '/test/time/2026/02/02-08/02-03/journal/morning.md',
  },
  {
    doc: doc(`---
time: "22:00"
tags: [Journal]
---
Evening review of the day.`),
    path: '/test/time/2026/02/02-08/02-04/journal/evening.md',
  },
]

const chats = [
  {
    doc: doc(`---
created: 2026-02-03
summary: Planning the Widget Launch
provider: claude
model: claude-opus-4-6
turns: 2
---
# Planning the Widget Launch`),
    path: '/test/time/2026/02/02-08/02-03/actions/ai-chats/09-15_Planning-the-Widget-Launch.md',
  },
  {
    doc: doc(`---
created: 2026-02-04
summary: Brainstorm Marketing Ideas
provider: claude
model: claude-haiku-4-5
turns: 1
---
# Brainstorm Marketing Ideas`),
    path: '/test/time/2026/02/02-08/02-04/actions/ai-chats/18-42_Brainstorm-Marketing-Ideas.md',
  },
]

const days = [
  {
    doc: doc(`---
date: "2026-02-03"
started: "07:30"
tags: [Day]
---
Day file.`),
    path: '/test/time/2026/02/02-08/02-03/day.md',
  },
  {
    doc: doc(`---
date: "2026-02-04"
started: "08:00"
tags: [Day]
---
Day file.`),
    path: '/test/time/2026/02/02-08/02-04/day.md',
  },
]

const people = [
  {
    doc: doc(`---
name: Alice Smith
org: Acme Corp
title: Engineer
---
Alice is an engineer.`),
    path: '/test/people/alice.md',
  },
  {
    doc: doc(`---
name: Bob Jones
org: Globex
title: Designer
---
Bob is a designer.`),
    path: '/test/people/bob.md',
  },
]

const orgs = [
  {
    doc: doc(`---
name: Acme Corp
sector: Software
---
Acme makes widgets.`),
    path: '/test/orgs/acme.md',
  },
  {
    doc: doc(`---
name: Globex
sector: Energy
---
Globex makes power.`),
    path: '/test/orgs/globex.md',
  },
]

const projects = [
  {
    doc: doc(`---
name: Widget-Launch
status: open
---
Launch the widget.`),
    path: '/test/projects/open/widget-launch/_project/overview.md',
  },
  {
    doc: doc(`---
name: Office-Move
status: closed
---
Move offices.`),
    path: '/test/projects/closed/office-move/_project/overview.md',
  },
]

// Folder files arrive from ProjectStore with the project rel injected
const projectFiles = [
  {
    doc: doc(`---
rel: [projects/Widget-Launch]
---
Launch checklist.`),
    path: '/test/projects/open/widget-launch/checklist.md',
  },
]

const decisions = [
  {
    doc: doc(`---
name: hire-designer
summary: Hire a new designer
identified: "2026-01-15"
---
Still open.`),
    path: '/test/decisions/hire-designer.md',
  },
  {
    doc: doc(`---
name: new-office
summary: Move to new office
identified: "2026-01-10"
resolved: "2026-01-25"
---
Decided.`),
    path: '/test/decisions/new-office.md',
  },
]

const goals = [
  {
    doc: doc(`---
name: Ship Widgets V2
status: active
---
Ship it.`),
    path: '/test/goals/ship-widgets.md',
  },
  {
    doc: doc(`---
name: Run a marathon
status: active
---
Train for it.`),
    path: '/test/goals/marathon.md',
  },
]

const ideas = [
  {
    doc: doc(`---
name: Robot assistant
---
Explore robots.`),
    path: '/test/ideas/exploring/robot.md',
  },
  {
    doc: doc(`---
name: Phone app
---
Draft idea.`),
    path: '/test/ideas/drafts/app.md',
  },
]

const places = [
  {
    doc: doc(`---
name: Don Julio
type: eat
location:
  country: AR
  city: Buenos Aires
---
Steakhouse.`),
    path: '/test/places/AR/Buenos-Aires/eat/Don-Julio.md',
  },
  {
    doc: doc(`---
name: Ty Bar
type: drink
location:
  country: US
  city: New York
---
Cocktail bar.`),
    path: '/test/places/US/NY/New-York/drink/Ty-Bar.md',
  },
]

function createMockMarkdownStore(): MarkdownStore {
  return {
    people: createMockCollection(people),
    orgs: createMockCollection(orgs),
    projects: {
      ...createMockCollection(projects),
      getDocuments: () => ({ toArray: () => projectFiles }),
    },
    decisions: createMockCollection(decisions),
    goals: createMockCollection(goals),
    ideas: createMockCollection(ideas),
    places: createMockCollection(places),
    time: createMockCollection([...meetings, ...messages, ...videos, ...journals, ...chats, ...days]),
  } as unknown as MarkdownStore
}

// =============================================================================
// Cases — one per DomainCollection root field
// =============================================================================

interface SmokeCase {
  field: string
  query: string
  expectPaths: string[]
}

const CASES: SmokeCase[] = [
  {
    field: 'meetings',
    query: '{ meetings(where: { whoContains: "Alice" }) { path } }',
    expectPaths: [meetings[0].path],
  },
  {
    field: 'messages',
    query: '{ messages(where: { from: "Kevin" }) { path } }',
    expectPaths: [messages[0].path],
  },
  {
    field: 'videos',
    query: '{ videos(where: { fromContains: "TechChannel" }) { path } }',
    expectPaths: [videos[0].path],
  },
  {
    field: 'journals',
    query: '{ journals(where: { bodyContains: "gratitude" }) { path } }',
    expectPaths: [journals[0].path],
  },
  {
    field: 'chats',
    query: '{ chats(where: { summaryContains: "Widget" }) { path } }',
    expectPaths: [chats[0].path],
  },
  {
    field: 'days',
    query: '{ days(where: { date: "2026-02-03" }) { path } }',
    expectPaths: [days[0].path],
  },
  {
    field: 'people',
    query: '{ people(where: { nameContains: "Alice" }) { path } }',
    expectPaths: [people[0].path],
  },
  {
    field: 'orgs',
    query: '{ orgs(where: { nameContains: "Acme" }) { path } }',
    expectPaths: [orgs[0].path],
  },
  {
    field: 'projects',
    query: '{ projects(where: { status: "open" }) { path } }',
    expectPaths: [projects[0].path],
  },
  {
    field: 'documents',
    query: '{ documents(where: { relContains: "Widget-Launch" }) { path } }',
    expectPaths: [projectFiles[0].path],
  },
  {
    field: 'decisions',
    query: '{ decisions(where: { pending: true }) { path } }',
    expectPaths: [decisions[0].path],
  },
  {
    field: 'goals',
    query: '{ goals(where: { nameContains: "Widgets" }) { path } }',
    expectPaths: [goals[0].path],
  },
  {
    field: 'ideas',
    query: '{ ideas(where: { status: "exploring" }) { path } }',
    expectPaths: [ideas[0].path],
  },
  {
    field: 'places',
    query: '{ places(where: { country: "AR" }) { path } }',
    expectPaths: [places[0].path],
  },
  {
    field: 'documents',
    query: '{ documents(where: { type: "goal" }) { path } }',
    expectPaths: goals.map((g) => g.path),
  },
]

// =============================================================================
// Test
// =============================================================================

async function runQuery(
  yoga: ReturnType<typeof createYogaInstance>,
  query: string,
): Promise<{ data?: Record<string, Array<{ path: string }>>; errors?: Array<{ message: string }> }> {
  const response = await yoga.fetch(
    new Request('http://yoga/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }),
  )
  return (await response.json()) as {
    data?: Record<string, Array<{ path: string }>>
    errors?: Array<{ message: string }>
  }
}

test('service yoga executes every DomainCollection root field with the filter applied', async (t) => {
  const yoga = createYogaInstance({} as Store, createMockMarkdownStore())

  for (const { field, query, expectPaths } of CASES) {
    await t.step(field, async () => {
      const result = await runQuery(yoga, query)

      assert({
        given: `a ${field} query through the yoga execution path`,
        should: 'execute without errors',
        actual: result.errors?.map((e) => e.message) ?? [],
        expected: [],
      })

      assert({
        given: `a ${field} query with a filter matching a known subset`,
        should: 'return exactly the matching rows (filter args reached the resolver)',
        actual: (result.data?.[field] ?? []).map((r) => r.path).toSorted(),
        expected: expectPaths.toSorted(),
      })
    })
  }
})

test('service yoga returns project folder files via Project.files', async () => {
  const yoga = createYogaInstance({} as Store, createMockMarkdownStore())

  const result = await runQuery(yoga, '{ projects(where: { nameContains: "Widget-Launch" }) { path files } }')

  assert({
    given: 'a projects query selecting files',
    should: 'execute without errors',
    actual: result.errors?.map((e) => e.message) ?? [],
    expected: [],
  })

  assert({
    given: 'a project with one folder file',
    should: 'list the folder file path',
    actual: (result.data?.projects ?? []).flatMap((p) => (p as unknown as { files: string[] }).files),
    expected: [projectFiles[0].path],
  })
})

test('service yoga tracks MarkdownStore mutations via version bumps', async () => {
  // Live mock: a mutable journal list plus a version counter, mimicking the
  // real MarkdownStore where the watcher's set()/delete() bump the version.
  // Guards the regression where yoga served the boot-time DomainCollection
  // for the whole process lifetime (deleted journals kept resolving).
  const liveJournals = [...journals]
  let version = 0
  const mdStore = {
    people: createMockCollection(people),
    orgs: createMockCollection(orgs),
    projects: {
      ...createMockCollection(projects),
      getDocuments: () => ({ toArray: () => projectFiles }),
    },
    decisions: createMockCollection(decisions),
    goals: createMockCollection(goals),
    ideas: createMockCollection(ideas),
    places: createMockCollection(places),
    time: { getAll: () => ({ toArray: () => liveJournals }) },
    get version() {
      return version
    },
  } as unknown as MarkdownStore
  const yoga = createYogaInstance({} as Store, mdStore)

  const before = await runQuery(yoga, '{ journals { path } }')

  // Mutate WITHOUT a version bump: the cached snapshot must keep serving
  liveJournals.pop()
  const cached = await runQuery(yoga, '{ journals { path } }')

  version++
  const after = await runQuery(yoga, '{ journals { path } }')

  assert({
    given: 'a journals query before any mutation',
    should: 'see both fixture journals',
    actual: (before.data?.journals ?? []).length,
    expected: 2,
  })

  assert({
    given: 'a store mutation without a version bump',
    should: 'keep serving the cached snapshot (rebuilds are version-gated)',
    actual: (cached.data?.journals ?? []).length,
    expected: 2,
  })

  assert({
    given: 'a store mutation with a version bump',
    should: 'rebuild the DomainCollection and reflect the change',
    actual: (after.data?.journals ?? []).length,
    expected: 1,
  })
})
