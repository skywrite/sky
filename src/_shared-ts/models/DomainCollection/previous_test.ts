import readTextFile from '#shared/fs/readTextFile.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import type { ResolveContext } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'
import { dayDir, parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import DomainCollection from './mod.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname
const WEEK_DIR = 'time/2026/01/19-25'

async function loadFixture(relativePath: string): Promise<string> {
  return readTextFile(`${FIXTURES_DIR}${relativePath}`)
}

function getNames(doc: PersonDocument | OrganizationDocument | ProjectDocument): string[] {
  const nameValue = doc.yaml['name']
  if (Array.isArray(nameValue)) return nameValue
  if (typeof nameValue === 'string') return [nameValue]
  return []
}

/** Regex for DD/subpath */
const RE_DD = /^(\d{2})\/(.+)$/
/** Regex for MM-DD/subpath */
const RE_MMDD = /^(\d{2})-(\d{2})\/(.+)$/

function createFixtureStore(
  people: Map<string, PersonDocument>,
  orgs: Map<string, OrganizationDocument>,
  timeDocs: Map<string, Document> = new Map(),
): MarkdownStore {
  // Resolve a time ref like DD/subpath or MM-DD/subpath against stored fixture paths
  function resolveTimeRef(raw: string, context?: ResolveContext): ResolvedRef | undefined {
    let match = raw.match(RE_MMDD)
    if (match) {
      const [, mm, dd, subpath] = match
      const year = context?.year
      if (!year) return undefined
      const date = new PlainDate(year, parseInt(mm, 10), parseInt(dd, 10))
      const dir = dayDir(date)
      for (const [path, doc] of timeDocs) {
        if (path.includes(`/${dir}/`) && (path.endsWith(`/${subpath}.md`) || path.endsWith(`/${subpath}`))) {
          return { type: 'document', value: doc, path, raw }
        }
      }
      return undefined
    }

    match = raw.match(RE_DD)
    if (match) {
      const [, dd, subpath] = match
      const year = context?.year
      const month = context?.month
      if (!year || !month) return undefined
      const date = new PlainDate(year, month, parseInt(dd, 10))
      const dir = dayDir(date)
      for (const [path, doc] of timeDocs) {
        if (path.includes(`/${dir}/`) && (path.endsWith(`/${subpath}.md`) || path.endsWith(`/${subpath}`))) {
          return { type: 'document', value: doc, path, raw }
        }
      }
    }

    return undefined
  }

  return {
    resolve(raw: string, context?: ResolveContext): ResolvedRef {
      for (const [path, doc] of people) {
        if (getNames(doc).includes(raw)) return { type: 'person', value: doc, path, raw }
      }
      for (const [path, doc] of orgs) {
        if (getNames(doc).includes(raw)) return { type: 'org', value: doc, path, raw }
      }
      const timeRef = resolveTimeRef(raw, context)
      if (timeRef) return timeRef
      if (/^https?:\/\//i.test(raw)) return { type: 'url', value: new URL(raw), raw }
      return { type: 'unresolved', value: null, raw }
    },
    resolveAll(rawStrings: Iterable<string>, context?: ResolveContext): ResolvedRef[] {
      return Array.from(rawStrings).map((raw) => this.resolve(raw, context))
    },
  } as MarkdownStore
}

async function loadStore() {
  const people = new Map<string, PersonDocument>()
  const orgs = new Map<string, OrganizationDocument>()
  const timeDocs = new Map<string, Document>()

  for (const file of ['Chen-Wei.md']) {
    const content = await loadFixture(`people/${file}`)
    people.set(`${FIXTURES_DIR}people/${file}`, PersonDocument.fromMarkdown(content))
  }
  for (const file of ['Acme-Corp.md']) {
    const content = await loadFixture(`orgs/${file}`)
    orgs.set(`${FIXTURES_DIR}orgs/${file}`, OrganizationDocument.fromMarkdown(content))
  }
  const msgFixtures = [
    { rel: `${WEEK_DIR}/01-21/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-1.md` },
    { rel: `${WEEK_DIR}/01-22/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-2.md` },
    { rel: `${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md` },
    { rel: 'time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md' },
  ]
  for (const { rel } of msgFixtures) {
    const content = await loadFixture(rel)
    timeDocs.set(`${FIXTURES_DIR}${rel}`, Document.fromMarkdown(content))
  }

  return { store: createFixtureStore(people, orgs, timeDocs) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemByPath(collection: DomainCollection, suffix: string) {
  return collection.allItems.find((i) => i.path.endsWith(suffix))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('previous chain - follows full chain from last message', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    `${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`,
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0 })

  const msg3 = itemByPath(collection, 'API-migration-update-3.md')
  const msg2 = itemByPath(collection, 'API-migration-update-2.md')
  const msg1 = itemByPath(collection, 'API-migration-update-1.md')

  assert({
    given: 'message-3 with previous chain',
    should: 'include message-3 (root)',
    actual: msg3 !== undefined,
    expected: true,
  })

  assert({
    given: 'message-3 with previous chain',
    should: 'include message-2 (via previous)',
    actual: msg2 !== undefined,
    expected: true,
  })

  assert({
    given: 'message-3 with previous chain',
    should: 'include message-1 (via previous chain)',
    actual: msg1 !== undefined,
    expected: true,
  })
})

test('previous chain - items inherit same depth as referencing document', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    `${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`,
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0 })

  const msg3 = itemByPath(collection, 'API-migration-update-3.md')
  const msg2 = itemByPath(collection, 'API-migration-update-2.md')
  const msg1 = itemByPath(collection, 'API-migration-update-1.md')

  assert({
    given: 'root message at depth 0',
    should: 'message-3 at depth 0',
    actual: msg3?.depth,
    expected: 0,
  })

  assert({
    given: 'previous chain from depth-0 root',
    should: 'message-2 at depth 0 (same as referencing doc)',
    actual: msg2?.depth,
    expected: 0,
  })

  assert({
    given: 'previous chain from depth-0 root',
    should: 'message-1 at depth 0 (same as referencing doc)',
    actual: msg1?.depth,
    expected: 0,
  })
})

test('previous chain - does not follow rel from chained messages', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    `${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`,
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`

  // depth: 0 means no rel traversal, but previous chain is still followed
  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0 })

  // message-1 has rel: [Acme Corp] but since we're following previous (not rel),
  // Acme Corp should NOT be pulled in
  const acme = itemByPath(collection, 'Acme-Corp.md')

  assert({
    given: 'depth 0 with previous chain — message-1 has rel: Acme Corp',
    should: 'NOT include Acme Corp (previous chain skips rel)',
    actual: acme,
    expected: undefined,
  })
})

test('previous chain - works alongside rel traversal', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    `${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`,
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`

  // depth: 1 enables rel traversal for the ROOT doc (message-3)
  // message-3 has no rel, but its from: Chen Wei should resolve
  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 1 })

  // Previous chain: all 3 messages present
  const msg1 = itemByPath(collection, 'API-migration-update-1.md')
  assert({
    given: 'depth 1 with previous chain',
    should: 'include message-1 from chain',
    actual: msg1 !== undefined,
    expected: true,
  })

  // Rel from root: Chen Wei (from: field on message-3)
  const chen = itemByPath(collection, 'Chen-Wei.md')
  assert({
    given: 'depth 1 — message-3 from: Chen Wei',
    should: 'include Chen Wei via rel traversal',
    actual: chen !== undefined,
    expected: true,
  })
})

test('previous chain - previousHops bounds how far back a chain is followed', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    'time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0, previousHops: 1 })

  assert({
    given: 'message-4 with a 3-link previous chain and previousHops: 1',
    should: 'include the immediate antecedent (message-3)',
    actual: itemByPath(collection, 'API-migration-update-3.md') !== undefined,
    expected: true,
  })

  assert({
    given: 'message-4 with a 3-link previous chain and previousHops: 1',
    should: 'stop before message-2 and message-1',
    actual: [
      itemByPath(collection, 'API-migration-update-2.md'),
      itemByPath(collection, 'API-migration-update-1.md'),
    ].every((i) => i === undefined),
    expected: true,
  })
})

test('previous chain - previousHops 0 disables chain following', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    `${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`,
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}${WEEK_DIR}/01-23/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-3.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0, previousHops: 0 })

  assert({
    given: 'message-3 with previousHops: 0',
    should: 'include only the root, no chained messages',
    actual: collection.paths.length,
    expected: 1,
  })
})

test('previous chain - fromDocuments honors previousHops', async () => {
  const { store } = await loadStore()
  const content = await loadFixture(
    'time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md`

  const collection = DomainCollection.fromDocuments([{ doc, path }], store, { depth: 0, previousHops: 2 })

  assert({
    given: 'fromDocuments with previousHops: 2 on a 3-link chain',
    should: 'include messages 3 and 2 but not the chain root',
    actual: [
      itemByPath(collection, 'API-migration-update-3.md') !== undefined,
      itemByPath(collection, 'API-migration-update-2.md') !== undefined,
      itemByPath(collection, 'API-migration-update-1.md') === undefined,
    ].every(Boolean),
    expected: true,
  })
})

test('previous chain - follows MM-DD/subpath across month boundaries', async () => {
  const { store } = await loadStore()
  // message-4 is in Feb, its previous uses 01-23/subpath to reach Jan message-3
  const content = await loadFixture(
    'time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md',
  )
  const doc = Document.fromMarkdown(content)
  const path = `${FIXTURES_DIR}time/2026/02/02-08/02-02/actions/messages/slack_Chen-Wei-to-eng_API-migration-update-4.md`

  const collection = DomainCollection.fromDocument(doc, path, store, { depth: 0 })

  const msg4 = itemByPath(collection, 'API-migration-update-4.md')
  const msg3 = itemByPath(collection, 'API-migration-update-3.md')
  const msg2 = itemByPath(collection, 'API-migration-update-2.md')
  const msg1 = itemByPath(collection, 'API-migration-update-1.md')

  assert({
    given: 'message-4 (Feb) with previous: 01-23/... (Jan)',
    should: 'include message-4 (root)',
    actual: msg4 !== undefined,
    expected: true,
  })

  assert({
    given: 'message-4 (Feb) with previous: 01-23/... (Jan)',
    should: 'include message-3 (cross-month via MM-DD)',
    actual: msg3 !== undefined,
    expected: true,
  })

  assert({
    given: 'message-4 (Feb) chains back through Jan',
    should: 'include message-2 (via message-3 previous)',
    actual: msg2 !== undefined,
    expected: true,
  })

  assert({
    given: 'message-4 (Feb) chains back through Jan',
    should: 'include message-1 (chain root)',
    actual: msg1 !== undefined,
    expected: true,
  })
})
