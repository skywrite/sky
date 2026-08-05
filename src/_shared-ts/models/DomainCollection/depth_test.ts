import readTextFile from '#shared/fs/readTextFile.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'
import { assert, test } from '#test'
import DomainCollection from './mod.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname

async function loadFixture(relativePath: string): Promise<string> {
  return readTextFile(`${FIXTURES_DIR}${relativePath}`)
}

function getNames(doc: PersonDocument | OrganizationDocument | ProjectDocument): string[] {
  const nameValue = doc.yaml['name']
  if (Array.isArray(nameValue)) return nameValue
  if (typeof nameValue === 'string') return [nameValue]
  return []
}

function createFixtureStore(
  people: Map<string, PersonDocument>,
  orgs: Map<string, OrganizationDocument>,
  projects: Map<string, ProjectDocument>,
  timeDocs: Map<string, Document> = new Map(),
): MarkdownStore {
  return {
    resolve(raw: string): ResolvedRef {
      for (const [path, doc] of people) {
        if (getNames(doc).includes(raw)) return { type: 'person', value: doc, path, raw }
      }
      for (const [path, doc] of orgs) {
        if (getNames(doc).includes(raw)) return { type: 'org', value: doc, path, raw }
      }
      for (const [path, doc] of projects) {
        const names = getNames(doc)
        const slug = doc.yaml['slug'] as string | undefined
        if (names.includes(raw)) return { type: 'project', value: doc, path, raw }
        if (slug && raw.toLowerCase() === `projects/${slug.toLowerCase()}`) {
          return { type: 'project', value: doc, path, raw }
        }
      }
      // Time doc resolution: match DD/subpath against stored paths
      for (const [path, doc] of timeDocs) {
        if (path.endsWith(`/${raw}.md`) || path.endsWith(`/${raw}`)) {
          return { type: 'document', value: doc, path, raw }
        }
      }
      if (/^https?:\/\//i.test(raw)) return { type: 'url', value: new URL(raw), raw }
      return { type: 'unresolved', value: null, raw }
    },
    resolveAll(rawStrings: Iterable<string>): ResolvedRef[] {
      return Array.from(rawStrings).map((raw) => this.resolve(raw))
    },
  } as MarkdownStore
}

async function loadFixtureStore() {
  const people = new Map<string, PersonDocument>()
  const orgs = new Map<string, OrganizationDocument>()
  const projects = new Map<string, ProjectDocument>()

  for (const file of ['Chen-Wei.md', 'Maria-Santos.md', 'Marcus-Johnson.md', 'Sarah-Mitchell.md']) {
    const content = await loadFixture(`people/${file}`)
    people.set(`${FIXTURES_DIR}people/${file}`, PersonDocument.fromMarkdown(content))
  }
  for (const file of ['Acme-Corp.md', 'Northwind-Ventures.md']) {
    const content = await loadFixture(`orgs/${file}`)
    orgs.set(`${FIXTURES_DIR}orgs/${file}`, OrganizationDocument.fromMarkdown(content))
  }
  for (const name of ['Product-Launch-Q1', 'Infrastructure-Upgrade', 'Series-B', 'Fitness-Goals']) {
    const relPath = `projects/open/${name}/_project/overview.md`
    const content = await loadFixture(relPath)
    projects.set(`${FIXTURES_DIR}${relPath}`, ProjectDocument.fromMarkdown(content))
  }

  return { store: createFixtureStore(people, orgs, projects), people, orgs, projects }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemByPath(collection: DomainCollection, suffix: string) {
  return collection.allItems.find((i) => i.path.endsWith(suffix))
}

// ---------------------------------------------------------------------------
// Tests: root documents get depth 0
// ---------------------------------------------------------------------------

test('depth - root document gets depth 0', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0 })
  const item = itemByPath(collection, 'Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md')

  assert({
    given: 'a root document with depth: 0',
    should: 'have depth 0',
    actual: item?.depth,
    expected: 0,
  })
})

// ---------------------------------------------------------------------------
// Tests: direct refs get depth 1
// ---------------------------------------------------------------------------

test('depth - direct who ref gets depth 1', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  // Meeting who: Chen Wei -> person at depth 1
  const collection = DomainCollection.fromDocument(doc, path, store)
  const chen = itemByPath(collection, 'people/Chen-Wei.md')

  assert({
    given: 'meeting with who: Chen Wei',
    should: 'resolve Chen Wei at depth 1',
    actual: chen?.depth,
    expected: 1,
  })
})

test('depth - direct rel ref gets depth 1', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  // Meeting rel: [projects/Product-Launch-Q1, Acme Corp] -> depth 1
  const collection = DomainCollection.fromDocument(doc, path, store)
  const project = itemByPath(collection, 'projects/open/Product-Launch-Q1/_project/overview.md')
  const org = itemByPath(collection, 'orgs/Acme-Corp.md')

  assert({
    given: 'meeting with rel: projects/Product-Launch-Q1',
    should: 'resolve project at depth 1',
    actual: project?.depth,
    expected: 1,
  })

  assert({
    given: 'meeting with rel: Acme Corp',
    should: 'resolve org at depth 1',
    actual: org?.depth,
    expected: 1,
  })
})

// ---------------------------------------------------------------------------
// Tests: transitive refs get depth 2
// ---------------------------------------------------------------------------

test('depth - person -> org chain gets depth 2', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md`

  // depth: 1 only -> Marcus (who) + Northwind (rel) + Series-B (rel)
  // Marcus has org: Acme Corp in his yaml, but depth 1 won't follow it
  const shallow = DomainCollection.fromDocument(doc, path, store, { depth: 1 })
  const acmeShallow = itemByPath(shallow, 'orgs/Acme-Corp.md')

  assert({
    given: 'depth 1 — Marcus has org: Acme Corp but that is a depth-2 traversal',
    should: 'NOT include Acme Corp',
    actual: acmeShallow,
    expected: undefined,
  })

  // depth: 2 -> follows Marcus -> org: Acme Corp
  const deep = DomainCollection.fromDocument(doc, path, store, { depth: 2 })
  const acmeDeep = itemByPath(deep, 'orgs/Acme-Corp.md')

  assert({
    given: 'depth 2 — Marcus -> org: Acme Corp',
    should: 'include Acme Corp at depth 2',
    actual: acmeDeep?.depth,
    expected: 2,
  })
})

test('depth - project -> person chain gets depth 2', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  // Meeting -> Product-Launch-Q1 (depth 1) -> rel: Maria Santos (depth 2)
  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 2 })
  const maria = itemByPath(collection, 'people/Maria-Santos.md')

  assert({
    given: 'meeting -> project -> Maria Santos (depth 2)',
    should: 'resolve Maria at depth 2',
    actual: maria?.depth,
    expected: 2,
  })
})

// ---------------------------------------------------------------------------
// Tests: full depth-2 snapshot
// ---------------------------------------------------------------------------

test('depth - full depth-2 graph from Marcus meeting', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 2 })

  // Build a map of fixture-relative path -> depth for every item
  // (project paths all end in _project/overview.md, so short suffixes collide)
  const depthMap = new Map<string, number>()
  for (const item of collection.allItems) {
    depthMap.set(item.path.replace(FIXTURES_DIR, ''), item.depth)
  }

  // Depth 0: meeting itself
  assert({
    given: 'Marcus meeting at depth 2',
    should: 'have meeting at depth 0',
    actual: depthMap.get('time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md'),
    expected: 0,
  })

  // Depth 1: who -> Marcus Johnson
  assert({
    given: 'Marcus meeting at depth 2',
    should: 'have Marcus at depth 1 (who field)',
    actual: depthMap.get('people/Marcus-Johnson.md'),
    expected: 1,
  })

  // Depth 1: rel -> Northwind Ventures
  assert({
    given: 'Marcus meeting at depth 2',
    should: 'have Northwind at depth 1 (rel field)',
    actual: depthMap.get('orgs/Northwind-Ventures.md'),
    expected: 1,
  })

  // Depth 1: rel -> Series-B project
  assert({
    given: 'Marcus meeting at depth 2',
    should: 'have Series-B at depth 1 (rel field)',
    actual: depthMap.get('projects/open/Series-B/_project/overview.md'),
    expected: 1,
  })

  // Depth 2: Marcus -> org: Acme Corp (also reached via Series-B rel)
  assert({
    given: 'Marcus meeting at depth 2',
    should: 'have Acme Corp at depth 2 (Marcus org + Series-B rel)',
    actual: depthMap.get('orgs/Acme-Corp.md'),
    expected: 2,
  })

  // Total: 5 items (meeting + Marcus + Northwind + Series-B + Acme)
  assert({
    given: 'Marcus meeting at depth 2',
    should: 'have exactly 5 items',
    actual: collection.size,
    expected: 5,
  })
})

// ---------------------------------------------------------------------------
// Tests: deduplication keeps lower depth
// ---------------------------------------------------------------------------

test('depth - duplicate entity keeps lower depth', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  // Acme Corp is referenced directly by the meeting (rel -> depth 1)
  // AND by Chen Wei's org field (who -> person -> org -> depth 2)
  // Should keep depth 1 since the direct ref is encountered first
  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 2 })
  const acme = itemByPath(collection, 'orgs/Acme-Corp.md')

  assert({
    given: 'Acme Corp referenced at both depth 1 (rel) and depth 2 (person->org)',
    should: 'keep the lower depth (1)',
    actual: acme?.depth,
    expected: 1,
  })
})

// ---------------------------------------------------------------------------
// Tests: fromDocuments with multiple roots
// ---------------------------------------------------------------------------

test('depth - fromDocuments marks all root docs as depth 0', async () => {
  const { store } = await loadFixtureStore()

  const meeting1Content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meeting2Content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md',
  )

  const docs = [
    {
      doc: Document.fromMarkdown(meeting1Content),
      path: `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`,
    },
    {
      doc: Document.fromMarkdown(meeting2Content),
      path: `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Marcus-Johnson_Investor-Relations-Update.md`,
    },
  ]

  const collection = DomainCollection.fromDocuments(docs, store, { depth: 1 })

  const meeting1 = itemByPath(collection, 'Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md')
  const meeting2 = itemByPath(collection, 'Zoom_Marcus-Johnson_Investor-Relations-Update.md')

  assert({
    given: 'fromDocuments with two meetings',
    should: 'first meeting at depth 0',
    actual: meeting1?.depth,
    expected: 0,
  })

  assert({
    given: 'fromDocuments with two meetings',
    should: 'second meeting at depth 0',
    actual: meeting2?.depth,
    expected: 0,
  })
})

// ---------------------------------------------------------------------------
// Tests: merge keeps lower depth
// ---------------------------------------------------------------------------

test('depth - merge keeps lower depth from either collection', async () => {
  const { store } = await loadFixtureStore()

  // Collection A: meeting at depth 0 -> Chen Wei at depth 1 -> Acme Corp at depth 2
  const meetingContent = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const meetingDoc = Document.fromMarkdown(meetingContent)
  const meetingPath = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`
  const collectionA = DomainCollection.fromDocument(meetingDoc, meetingPath, store, { depth: 2 })

  // Collection B: Acme Corp directly as root (depth 0)
  const acmeContent = await loadFixture('orgs/Acme-Corp.md')
  const acmeDoc = Document.fromMarkdown(acmeContent)
  const acmePath = `${FIXTURES_DIR}orgs/Acme-Corp.md`
  const collectionB = DomainCollection.fromDocument(acmeDoc, acmePath, store, { depth: 0 })

  // In A, Acme is at depth 1 (direct rel from meeting)
  const acmeInA = collectionA.allItems.find((i) => i.path.endsWith('orgs/Acme-Corp.md'))
  assert({
    given: 'collection A via meeting rel',
    should: 'have Acme at depth 1',
    actual: acmeInA?.depth,
    expected: 1,
  })

  // In B, Acme is at depth 0 (root)
  const acmeInB = collectionB.allItems.find((i) => i.path.endsWith('orgs/Acme-Corp.md'))
  assert({
    given: 'collection B with Acme as root',
    should: 'have Acme at depth 0',
    actual: acmeInB?.depth,
    expected: 0,
  })

  // Merge A into B: Acme should be depth 0 (lower wins)
  const merged = collectionA.merge(collectionB)
  const acmeMerged = merged.allItems.find((i) => i.path.endsWith('orgs/Acme-Corp.md'))

  assert({
    given: 'merge where Acme is depth 1 in A and depth 0 in B',
    should: 'keep the lower depth (0)',
    actual: acmeMerged?.depth,
    expected: 0,
  })
})

// ---------------------------------------------------------------------------
// Tests: allItems accessor
// ---------------------------------------------------------------------------

test('depth - allItems returns items with depth metadata', async () => {
  const { store } = await loadFixtureStore()
  const content = await loadFixture(
    'time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/01/20-26/01-23/actions/meetings/Zoom_Chen-Wei_Q1-Product-Roadmap-Review.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 1 })
  const items = collection.allItems

  assert({
    given: 'allItems on a collection',
    should: 'return same count as size',
    actual: items.length,
    expected: collection.size,
  })

  // Every item should have a numeric depth
  const allHaveDepth = items.every((i) => typeof i.depth === 'number')
  assert({
    given: 'allItems',
    should: 'every item has a numeric depth',
    actual: allHaveDepth,
    expected: true,
  })

  // Root = depth 0, refs = depth 1
  const depths = new Set(items.map((i) => i.depth))
  assert({
    given: 'meeting with depth 1 traversal',
    should: 'have exactly depths 0 and 1',
    actual: [...depths].sort(),
    expected: [0, 1],
  })
})
