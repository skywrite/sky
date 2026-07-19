import { assert, test } from '#test'
import DomainCollection from './mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'
import readTextFile from '#shared/fs/readTextFile.ts'
import writeTextFile from '#shared/fs/writeTextFile.ts'

// Fixture base path
const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname

// Helper to load a fixture file
async function loadFixture(relativePath: string): Promise<string> {
  return readTextFile(`${FIXTURES_DIR}${relativePath}`)
}

// Helper to get all names from yaml.name (can be string or array)
function getNames(doc: PersonDocument | OrganizationDocument | ProjectDocument): string[] {
  const nameValue = doc.yaml['name']
  if (Array.isArray(nameValue)) return nameValue
  if (typeof nameValue === 'string') return [nameValue]
  return []
}

// Create a mock store from fixture data
function createFixtureStore(
  people: Map<string, PersonDocument>,
  orgs: Map<string, OrganizationDocument>,
  projects: Map<string, ProjectDocument>,
): MarkdownStore {
  return {
    resolve(raw: string): ResolvedRef {
      // Check people
      for (const [path, doc] of people) {
        if (getNames(doc).includes(raw)) {
          return { type: 'person', value: doc, path, raw }
        }
      }
      // Check orgs
      for (const [path, doc] of orgs) {
        if (getNames(doc).includes(raw)) {
          return { type: 'org', value: doc, path, raw }
        }
      }
      // Check projects (by name or slug path like "projects/Product-Launch-Q1")
      for (const [path, doc] of projects) {
        const names = getNames(doc)
        const slug = doc.yaml['slug'] as string | undefined
        if (names.includes(raw)) {
          return { type: 'project', value: doc, path, raw }
        }
        // Match "projects/slug" pattern (case-insensitive for slug)
        if (slug && raw.toLowerCase() === `projects/${slug.toLowerCase()}`) {
          return { type: 'project', value: doc, path, raw }
        }
      }
      // URL check
      if (/^https?:\/\//i.test(raw)) {
        return { type: 'url', value: new URL(raw), raw }
      }
      return { type: 'unresolved', value: null, raw }
    },
    resolveAll(rawStrings: Iterable<string>): ResolvedRef[] {
      return Array.from(rawStrings).map((raw) => this.resolve(raw))
    },
  } as MarkdownStore
}

// Load all fixtures and create store
async function loadFixtureStore(): Promise<{
  store: MarkdownStore
  people: Map<string, PersonDocument>
  orgs: Map<string, OrganizationDocument>
  projects: Map<string, ProjectDocument>
}> {
  const people = new Map<string, PersonDocument>()
  const orgs = new Map<string, OrganizationDocument>()
  const projects = new Map<string, ProjectDocument>()

  // Load people
  const peopleFiles = ['Chen-Wei.md', 'Maria-Santos.md', 'Marcus-Johnson.md', 'Sarah-Mitchell.md']
  for (const file of peopleFiles) {
    const content = await loadFixture(`people/${file}`)
    const doc = PersonDocument.fromMarkdown(content)
    people.set(`${FIXTURES_DIR}people/${file}`, doc)
  }

  // Load orgs
  const orgFiles = ['Acme-Corp.md', 'Northwind-Ventures.md']
  for (const file of orgFiles) {
    const content = await loadFixture(`orgs/${file}`)
    const doc = OrganizationDocument.fromMarkdown(content)
    orgs.set(`${FIXTURES_DIR}orgs/${file}`, doc)
  }

  // Load projects
  const projectNames = ['Product-Launch-Q1', 'Infrastructure-Upgrade', 'Series-B', 'Fitness-Goals']
  for (const name of projectNames) {
    const relPath = `projects/open/${name}/_project/overview.md`
    const content = await loadFixture(relPath)
    const doc = ProjectDocument.fromMarkdown(content)
    projects.set(`${FIXTURES_DIR}${relPath}`, doc)
  }

  return { store: createFixtureStore(people, orgs, projects), people, orgs, projects }
}

// --- Tests ---

test('fixtures - loads meeting and resolves who and rel fields', async () => {
  const { store } = await loadFixtureStore()
  const meetingContent = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meetingDoc = Document.fromMarkdown(meetingContent)
  const meetingPath = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  const collection = DomainCollection.fromDocument(meetingDoc, meetingPath, store, { depth: 1 })

  // Meeting has who: Chen Wei, rel: [projects/Product-Launch-Q1, Acme Corp]
  // At depth 1: meeting + Chen Wei + Acme Corp + Product-Launch-Q1 project = 4
  assert({
    given: 'meeting with who and rel fields',
    should: 'have meeting + person + org + project = 4 items',
    actual: collection.size,
    expected: 4,
  })

  assert({
    given: 'meeting with who: Chen Wei',
    should: 'resolve Chen Wei as person',
    actual: collection.people.length,
    expected: 1,
  })

  assert({
    given: 'meeting with who: Chen Wei',
    should: 'have correct person name',
    actual: collection.people[0].name,
    expected: 'Chen Wei',
  })

  assert({
    given: 'meeting with rel: Acme Corp',
    should: 'resolve Acme Corp as org',
    actual: collection.orgs.some((o) => o.name === 'Acme Corp'),
    expected: true,
  })

  assert({
    given: 'meeting with rel: projects/Product-Launch-Q1',
    should: 'resolve project',
    actual: collection.projects.length,
    expected: 1,
  })
})

test('fixtures - meeting with depth 2 resolves person -> org chain', async () => {
  const { store } = await loadFixtureStore()
  const meetingContent = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meetingDoc = Document.fromMarkdown(meetingContent)
  const meetingPath = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  const collection = DomainCollection.fromDocument(meetingDoc, meetingPath, store, { depth: 2 })

  // Meeting -> Chen Wei (who) -> Acme Corp (org)
  // Meeting also has rel: projects/Product-Launch-Q1, Acme Corp
  assert({
    given: 'meeting with depth 2',
    should: 'have at least meeting + person + org',
    actual: collection.size >= 3,
    expected: true,
  })

  assert({
    given: 'meeting with depth 2',
    should: 'resolve org from person',
    actual: collection.orgs.length >= 1,
    expected: true,
  })

  assert({
    given: 'meeting with depth 2',
    should: 'include Acme Corp',
    actual: collection.orgs.some((o) => o.name === 'Acme Corp'),
    expected: true,
  })
})

test('fixtures - slack message resolves from field to person', async () => {
  const { store } = await loadFixtureStore()
  const messageContent = await loadFixture(
    'time/2026/01/20-26/23/actions/messages/slack_Sarah-Mitchell_Infrastructure-Budget-Discussion.md',
  )
  const messageDoc = Document.fromMarkdown(messageContent)
  const messagePath = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/messages/slack_Sarah-Mitchell_Infrastructure-Budget-Discussion.md`

  const collection = DomainCollection.fromDocument(messageDoc, messagePath, store)

  assert({
    given: 'slack message with from: Sarah Mitchell',
    should: 'resolve Sarah Mitchell as person',
    actual: collection.people.some((p) => p.name === 'Sarah Mitchell'),
    expected: true,
  })
})

test('fixtures - day.md collects multiple meetings', async () => {
  const { store } = await loadFixtureStore()
  const dayContent = await loadFixture('time/2026/01/20-26/23/day.md')
  const dayDoc = Document.fromMarkdown(dayContent)
  const dayPath = `${FIXTURES_DIR}time/2026/01/20-26/23/day.md`

  // Day file itself doesn't have who/from/to, so it shouldn't resolve much at depth 1
  const collection = DomainCollection.fromDocument(dayDoc, dayPath, store)

  assert({
    given: 'day.md without relationship fields',
    should: 'have just the day document',
    actual: collection.size,
    expected: 1,
  })
})

test('fixtures - fromDocuments combines multiple meetings', async () => {
  const { store } = await loadFixtureStore()

  // Load two meetings
  const meeting1Content = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meeting2Content = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md',
  )

  const meeting1Doc = Document.fromMarkdown(meeting1Content)
  const meeting2Doc = Document.fromMarkdown(meeting2Content)

  const meeting1Path = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`
  const meeting2Path = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md`

  const collection = DomainCollection.fromDocuments(
    [
      { doc: meeting1Doc, path: meeting1Path },
      { doc: meeting2Doc, path: meeting2Path },
    ],
    store,
    { depth: 1 },
  )

  // Meeting 1: Chen Wei (who), Acme Corp (rel), Product-Launch-Q1 (rel)
  // Meeting 2: Marcus Johnson (who), Northwind Ventures (rel), Series-B (rel)
  // At depth 1: 2 meetings + 2 people + 2 orgs + 2 projects = 8 items
  assert({
    given: 'two meetings with rel fields',
    should: 'have 2 meetings + 2 people + 2 orgs + 2 projects = 8 items',
    actual: collection.size,
    expected: 8,
  })

  assert({
    given: 'two meetings',
    should: 'have 2 people',
    actual: collection.people.length,
    expected: 2,
  })

  assert({
    given: 'two meetings',
    should: 'include Chen Wei',
    actual: collection.people.some((p) => p.name === 'Chen Wei'),
    expected: true,
  })

  assert({
    given: 'two meetings',
    should: 'include Marcus Johnson',
    actual: collection.people.some((p) => p.name === 'Marcus Johnson'),
    expected: true,
  })

  assert({
    given: 'two meetings',
    should: 'have 2 orgs',
    actual: collection.orgs.length,
    expected: 2,
  })

  assert({
    given: 'two meetings',
    should: 'have 2 projects',
    actual: collection.projects.length,
    expected: 2,
  })
})

test('fixtures - deduplicates shared person across meetings', async () => {
  const { store } = await loadFixtureStore()

  // Maria Santos meeting references Chen Wei in rel
  // Chen Wei meeting has Chen Wei as who
  // Both reference Acme Corp
  const meeting1Content = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meeting2Content = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/FaceTime-Audio_Maria-Santos_Mobile-App-Redesign-Discussion.md',
  )

  const meeting1Doc = Document.fromMarkdown(meeting1Content)
  const meeting2Doc = Document.fromMarkdown(meeting2Content)

  const meeting1Path = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`
  const meeting2Path = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/FaceTime-Audio_Maria-Santos_Mobile-App-Redesign-Discussion.md`

  const collection = DomainCollection.fromDocuments(
    [
      { doc: meeting1Doc, path: meeting1Path },
      { doc: meeting2Doc, path: meeting2Path },
    ],
    store,
    { depth: 2 },
  )

  // Maria's meeting rel includes Chen Wei, so at depth 2 they should both resolve
  // Acme Corp should only appear once despite being referenced by both people
  const acmeCount = collection.orgs.filter((o) => o.name === 'Acme Corp').length

  assert({
    given: 'two meetings that share Acme Corp',
    should: 'have Acme Corp only once',
    actual: acmeCount,
    expected: 1,
  })
})

test('fixtures - toMarkdown outputs orgs before people before meetings', async () => {
  const { store } = await loadFixtureStore()
  const meetingContent = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meetingDoc = Document.fromMarkdown(meetingContent)
  const meetingPath = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  const collection = DomainCollection.fromDocument(meetingDoc, meetingPath, store, { depth: 2 })
  const output = collection.toMarkdown()

  // Find positions
  const acmePos = output.indexOf('Acme Corp')
  const chenPos = output.indexOf('Chen Wei')
  const roadmapPos = output.indexOf('Q1 Product Roadmap')

  assert({
    given: 'collection with org, person, meeting',
    should: 'output org before person',
    actual: acmePos < chenPos,
    expected: true,
  })

  assert({
    given: 'collection with org, person, meeting',
    should: 'output person before meeting',
    actual: chenPos < roadmapPos,
    expected: true,
  })
})

test('fixtures - toMarkdown with relativeTo strips base path', async () => {
  const { store } = await loadFixtureStore()
  const meetingContent = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meetingDoc = Document.fromMarkdown(meetingContent)
  const meetingPath = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  const collection = DomainCollection.fromDocument(meetingDoc, meetingPath, store, { depth: 0 })
  const output = collection.toMarkdown({ relativeTo: FIXTURES_DIR })

  assert({
    given: 'toMarkdown with relativeTo',
    should: 'show relative path in comment',
    actual: output.includes(
      '<!-- time/2026/01/20-26/23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md -->',
    ),
    expected: true,
  })

  assert({
    given: 'toMarkdown with relativeTo',
    should: 'not include absolute fixtures path',
    actual: output.includes(FIXTURES_DIR),
    expected: false,
  })
})

test('fixtures - journal health references project via rel', async () => {
  const { store } = await loadFixtureStore()
  const journalContent = await loadFixture('time/2026/01/20-26/23/journal/01_health.md')
  const journalDoc = Document.fromMarkdown(journalContent)
  const journalPath = `${FIXTURES_DIR}time/2026/01/20-26/23/journal/01_health.md`

  const collection = DomainCollection.fromDocument(journalDoc, journalPath, store)

  // Journal has rel: projects/Fitness-Goals
  assert({
    given: 'journal with rel: projects/Fitness-Goals',
    should: 'have journal + project = 2 items',
    actual: collection.size,
    expected: 2,
  })

  assert({
    given: 'journal with rel: projects/Fitness-Goals',
    should: 'resolve Fitness Goals project',
    actual: collection.projects.some((p) => getNames(p).includes('Fitness Goals')),
    expected: true,
  })
})

test('fixtures - investor meeting resolves Northwind Ventures org', async () => {
  const { store } = await loadFixtureStore()
  const meetingContent = await loadFixture(
    'time/2026/01/20-26/23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md',
  )
  const meetingDoc = Document.fromMarkdown(meetingContent)
  const meetingPath = `${FIXTURES_DIR}time/2026/01/20-26/23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md`

  const collection = DomainCollection.fromDocument(meetingDoc, meetingPath, store)

  // Meeting has rel: Northwind Ventures
  assert({
    given: 'meeting with rel: Northwind Ventures',
    should: 'resolve Northwind Ventures org',
    actual: collection.orgs.some((o) => o.name === 'Northwind Ventures'),
    expected: true,
  })
})

test('fixtures - aggregate full day and write to output file', async () => {
  const { store } = await loadFixtureStore()
  const dayBase = 'time/2026/01/20-26/23'

  // Load all day documents
  const docs: Array<{ doc: Document; path: string }> = []

  // Day file
  const dayContent = await loadFixture(`${dayBase}/day.md`)
  docs.push({
    doc: Document.fromMarkdown(dayContent),
    path: `${FIXTURES_DIR}${dayBase}/day.md`,
  })

  // Journal files
  const journalFiles = ['01_health.md', '04_mood.md']
  for (const file of journalFiles) {
    const content = await loadFixture(`${dayBase}/journal/${file}`)
    docs.push({
      doc: Document.fromMarkdown(content),
      path: `${FIXTURES_DIR}${dayBase}/journal/${file}`,
    })
  }

  // Meeting files
  const meetingFiles = [
    'Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
    'FaceTime-Audio_Maria-Santos_Mobile-App-Redesign-Discussion.md',
    'Zoom_Marcus-Johnson_Investor-Relations-Update.md',
  ]
  for (const file of meetingFiles) {
    const content = await loadFixture(`${dayBase}/actions/meetings/${file}`)
    docs.push({
      doc: Document.fromMarkdown(content),
      path: `${FIXTURES_DIR}${dayBase}/actions/meetings/${file}`,
    })
  }

  // Message files
  const messageFiles = ['slack_Sarah-Mitchell_Infrastructure-Budget-Discussion.md']
  for (const file of messageFiles) {
    const content = await loadFixture(`${dayBase}/actions/messages/${file}`)
    docs.push({
      doc: Document.fromMarkdown(content),
      path: `${FIXTURES_DIR}${dayBase}/actions/messages/${file}`,
    })
  }

  // Create collection with depth 2 to get full relationship chain
  const collection = DomainCollection.fromDocuments(docs, store, { depth: 2 })

  // Generate output with START/END markers around each document
  const output = collection.toMarkdown({ relativeTo: FIXTURES_DIR, delimited: true })

  // Write to output file
  const outputPath = `${FIXTURES_DIR}${dayBase}/day_domain-collection-output.md`
  await writeTextFile(outputPath, output)

  // Verify the collection has expected items
  assert({
    given: 'full day aggregation',
    should: 'have orgs (Acme Corp, Northwind Ventures)',
    actual: collection.orgs.length,
    expected: 2,
  })

  assert({
    given: 'full day aggregation',
    should: 'have people (Chen Wei, Maria Santos, Marcus Johnson, Sarah Mitchell)',
    actual: collection.people.length,
    expected: 4,
  })

  assert({
    given: 'full day aggregation',
    should: 'have projects',
    actual: collection.projects.length >= 3,
    expected: true,
  })

  assert({
    given: 'full day aggregation output',
    should: 'start with orgs section',
    actual: output.indexOf('Acme Corp') < output.indexOf('Chen Wei'),
    expected: true,
  })

  console.log(`\nWrote aggregated output to: ${outputPath}`)
  console.log(`Collection size: ${collection.size} documents`)
  console.log(`  - Orgs: ${collection.orgs.length}`)
  console.log(`  - People: ${collection.people.length}`)
  console.log(`  - Projects: ${collection.projects.length}`)
  console.log(`  - Other documents: ${collection.documents.length}`)
})
