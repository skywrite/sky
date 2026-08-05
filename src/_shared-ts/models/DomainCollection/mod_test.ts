import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'
import { assert, test } from '#test'
import DomainCollection from './mod.ts'

// Helper to create markdown with YAML frontmatter
function md(yaml: string, body: string): string {
  return `---\n${yaml}\n---\n${body}`
}

// Mock store for testing
// Helper to get all names from yaml.name (can be string or array)
function getNames(doc: PersonDocument | OrganizationDocument): string[] {
  const nameValue = doc.yaml['name']
  if (Array.isArray(nameValue)) return nameValue
  if (typeof nameValue === 'string') return [nameValue]
  return []
}

function createMockStore(people: Map<string, PersonDocument>, orgs: Map<string, OrganizationDocument>): MarkdownStore {
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

test('DomainCollection.fromDocument - creates collection with root document', () => {
  const doc = Document.fromMarkdown(md('title: Test', '# Test content'))
  const store = createMockStore(new Map(), new Map())
  const path = '/time/2026/01/01-21/meeting.md'

  const collection = DomainCollection.fromDocument(doc, path, store)

  assert({
    given: 'a single document',
    should: 'have size 1',
    actual: collection.size,
    expected: 1,
  })

  assert({
    given: 'a single document',
    should: 'have the path',
    actual: collection.paths,
    expected: [path],
  })

  assert({
    given: 'a single document',
    should: 'have 1 document',
    actual: collection.documents.length,
    expected: 1,
  })
})

test('DomainCollection.fromDocument - excludes root when includeRoot is false', () => {
  const doc = Document.fromMarkdown(md('title: Test', '# Test'))
  const store = createMockStore(new Map(), new Map())
  const path = '/time/2026/01/01-21/meeting.md'

  const collection = DomainCollection.fromDocument(doc, path, store, { includeRoot: false })

  assert({
    given: 'includeRoot: false',
    should: 'have size 0',
    actual: collection.size,
    expected: 0,
  })
})

test('DomainCollection.fromDocument - resolves who field to people', () => {
  const alice = PersonDocument.fromMarkdown(md('name: Alice Smith', '# Alice'))
  const people = new Map([['/people/Alice-Smith.md', alice]])
  const store = createMockStore(people, new Map())

  const doc = Document.fromMarkdown(md('title: Meeting\nwho: Alice Smith', '# Meeting notes'))
  const collection = DomainCollection.fromDocument(doc, '/meeting.md', store)

  assert({
    given: 'document with who field',
    should: 'have 2 items (doc + person)',
    actual: collection.size,
    expected: 2,
  })

  assert({
    given: 'document with who field',
    should: 'have 1 person',
    actual: collection.people.length,
    expected: 1,
  })

  assert({
    given: 'document with who field',
    should: 'resolve person name',
    actual: collection.people[0].name,
    expected: 'Alice Smith',
  })
})

test('DomainCollection.fromDocument - resolves org field from person with depth 2', () => {
  const acme = OrganizationDocument.fromMarkdown(md('name: Acme Corp', '# Acme'))
  const alice = PersonDocument.fromMarkdown(md('name: Alice\norg: Acme Corp', '# Alice'))

  const people = new Map([['/people/Alice.md', alice]])
  const orgs = new Map([['/orgs/Acme.md', acme]])
  const store = createMockStore(people, orgs)

  const doc = Document.fromMarkdown(md('who: Alice', '# Meeting'))
  const collection = DomainCollection.fromDocument(doc, '/meeting.md', store, { depth: 2 })

  assert({
    given: 'depth 2',
    should: 'have 3 items (meeting + alice + acme)',
    actual: collection.size,
    expected: 3,
  })

  assert({
    given: 'depth 2',
    should: 'have 1 org',
    actual: collection.orgs.length,
    expected: 1,
  })

  assert({
    given: 'depth 2',
    should: 'resolve org name',
    actual: collection.orgs[0].name,
    expected: 'Acme Corp',
  })
})

test('DomainCollection.fromDocument - does not traverse beyond depth 1', () => {
  const acme = OrganizationDocument.fromMarkdown(md('name: Acme Corp', '# Acme'))
  const alice = PersonDocument.fromMarkdown(md('name: Alice\norg: Acme Corp', '# Alice'))

  const people = new Map([['/people/Alice.md', alice]])
  const orgs = new Map([['/orgs/Acme.md', acme]])
  const store = createMockStore(people, orgs)

  const doc = Document.fromMarkdown(md('who: Alice', '# Meeting'))
  const collection = DomainCollection.fromDocument(doc, '/meeting.md', store, { depth: 1 })

  assert({
    given: 'depth 1',
    should: 'have 2 items (meeting + alice only)',
    actual: collection.size,
    expected: 2,
  })

  assert({
    given: 'depth 1',
    should: 'not have orgs',
    actual: collection.orgs.length,
    expected: 0,
  })
})

test('DomainCollection.fromDocument - deduplicates documents by path', () => {
  const alice = PersonDocument.fromMarkdown(md('name: Alice', '# Alice'))
  const people = new Map([['/people/Alice.md', alice]])
  const store = createMockStore(people, new Map())

  // Document references Alice twice
  const doc = Document.fromMarkdown(md('who:\n  - Alice\nrel:\n  - Alice', '# Meeting'))
  const collection = DomainCollection.fromDocument(doc, '/meeting.md', store)

  assert({
    given: 'duplicate references',
    should: 'have 2 items (meeting + alice, not duplicated)',
    actual: collection.size,
    expected: 2,
  })

  assert({
    given: 'duplicate references',
    should: 'have 1 person',
    actual: collection.people.length,
    expected: 1,
  })
})

test('DomainCollection.fromDocuments - combines multiple documents', () => {
  const doc1 = Document.fromMarkdown(md('title: Meeting 1', '# M1'))
  const doc2 = Document.fromMarkdown(md('title: Meeting 2', '# M2'))
  const store = createMockStore(new Map(), new Map())

  const collection = DomainCollection.fromDocuments(
    [
      { doc: doc1, path: '/m1.md' },
      { doc: doc2, path: '/m2.md' },
    ],
    store,
  )

  assert({
    given: 'two documents',
    should: 'have size 2',
    actual: collection.size,
    expected: 2,
  })
})

test('DomainCollection.fromRefs - creates collection from resolved refs', () => {
  const alice = PersonDocument.fromMarkdown(md('name: Alice', '# Alice'))
  const refs: ResolvedRef[] = [{ type: 'person', value: alice, path: '/people/Alice.md', raw: 'Alice' }]
  const store = createMockStore(new Map(), new Map())

  const collection = DomainCollection.fromRefs(refs, store, { depth: 0 })

  assert({
    given: 'person ref',
    should: 'have size 1',
    actual: collection.size,
    expected: 1,
  })

  assert({
    given: 'person ref',
    should: 'have 1 person',
    actual: collection.people.length,
    expected: 1,
  })
})

test('DomainCollection.fromRefs - skips url and unresolved refs', () => {
  const refs: ResolvedRef[] = [
    { type: 'url', value: new URL('https://example.com'), raw: 'https://example.com' },
    { type: 'unresolved', value: null, raw: 'Unknown' },
  ]
  const store = createMockStore(new Map(), new Map())

  const collection = DomainCollection.fromRefs(refs, store)

  assert({
    given: 'url and unresolved refs',
    should: 'have size 0',
    actual: collection.size,
    expected: 0,
  })
})

test('DomainCollection.toMarkdown - outputs orgs before people before documents', () => {
  const acme = OrganizationDocument.fromMarkdown(md('name: Acme', '# Acme Corp'))
  const alice = PersonDocument.fromMarkdown(md('name: Alice', '# Alice Bio'))
  const meeting = Document.fromMarkdown(md('title: Meeting', '# Meeting Notes'))

  const store = createMockStore(new Map(), new Map())

  // Add in reverse order to test sorting
  const collection = DomainCollection.fromDocuments(
    [
      { doc: meeting, path: '/time/meeting.md' },
      { doc: alice, path: '/people/Alice.md' },
      { doc: acme, path: '/orgs/Acme.md' },
    ],
    store,
    { depth: 0 },
  )

  const output = collection.toMarkdown()

  // Orgs should come first
  const acmeIdx = output.indexOf('Acme')
  const aliceIdx = output.indexOf('Alice')
  const meetingIdx = output.indexOf('Meeting')

  assert({
    given: 'mixed types',
    should: 'output orgs before people',
    actual: acmeIdx < aliceIdx,
    expected: true,
  })

  assert({
    given: 'mixed types',
    should: 'output people before documents',
    actual: aliceIdx < meetingIdx,
    expected: true,
  })
})

test('DomainCollection.toMarkdown - includes path comments by default', () => {
  const doc = Document.fromMarkdown(md('title: Test', '# Test'))
  const store = createMockStore(new Map(), new Map())
  const collection = DomainCollection.fromDocument(doc, '/path/to/file.md', store)

  const output = collection.toMarkdown()

  assert({
    given: 'default options',
    should: 'include path comment',
    actual: output.includes('<!-- /path/to/file.md -->'),
    expected: true,
  })
})

test('DomainCollection.toMarkdown - excludes path when includePath is false', () => {
  const doc = Document.fromMarkdown(md('title: Test', '# Test'))
  const store = createMockStore(new Map(), new Map())
  const collection = DomainCollection.fromDocument(doc, '/path/to/file.md', store)

  const output = collection.toMarkdown({ includePath: false })

  assert({
    given: 'includePath: false',
    should: 'not include path comment',
    actual: output.includes('/path/to/file.md'),
    expected: false,
  })

  // Should still have START/END markers (delimited: true by default)
  assert({
    given: 'includePath: false with delimited: true (default)',
    should: 'still include START FILE marker',
    actual: output.includes('<!-- START FILE -->'),
    expected: true,
  })
})

test('DomainCollection.toMarkdown - makes paths relative when relativeTo is provided', () => {
  const doc = Document.fromMarkdown(md('title: Test', '# Test'))
  const store = createMockStore(new Map(), new Map())
  const collection = DomainCollection.fromDocument(doc, '/home/user/Notebook/time/file.md', store)

  const output = collection.toMarkdown({ relativeTo: '/home/user/Notebook' })

  assert({
    given: 'relativeTo option',
    should: 'show relative path',
    actual: output.includes('<!-- time/file.md -->'),
    expected: true,
  })

  assert({
    given: 'relativeTo option',
    should: 'not include base path',
    actual: output.includes('/home/user/Notebook'),
    expected: false,
  })
})

test('DomainCollection.toMarkdown - uses custom separator', () => {
  const doc1 = Document.fromMarkdown(md('title: A', '# A'))
  const doc2 = Document.fromMarkdown(md('title: B', '# B'))
  const store = createMockStore(new Map(), new Map())

  const collection = DomainCollection.fromDocuments(
    [
      { doc: doc1, path: '/a.md' },
      { doc: doc2, path: '/b.md' },
    ],
    store,
    { depth: 0 },
  )

  const output = collection.toMarkdown({ separator: '\n\n===\n\n' })

  assert({
    given: 'custom separator',
    should: 'use provided separator',
    actual: output.includes('==='),
    expected: true,
  })

  // Note: YAML frontmatter contains '---', so we check for the separator pattern
  // The custom separator should appear between documents, not the default '\n---\n'
  assert({
    given: 'custom separator',
    should: 'not use default separator pattern between docs',
    actual: output.includes('\n---\n<!-- /'),
    expected: false,
  })
})

test('DomainCollection.has - checks if path exists', () => {
  const doc = Document.fromMarkdown(md('title: Test', '# Test'))
  const store = createMockStore(new Map(), new Map())
  const collection = DomainCollection.fromDocument(doc, '/test.md', store)

  assert({
    given: 'existing path',
    should: 'return true',
    actual: collection.has('/test.md'),
    expected: true,
  })

  assert({
    given: 'non-existing path',
    should: 'return false',
    actual: collection.has('/other.md'),
    expected: false,
  })
})
