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

function createMockStore(): MarkdownStore {
  return {
    resolve(raw: string): ResolvedRef {
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

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

test('DomainCollection.merge - combines two collections', () => {
  const doc1 = Document.fromMarkdown(md('title: Meeting 1', '# M1'))
  const doc2 = Document.fromMarkdown(md('title: Meeting 2', '# M2'))
  const store = createMockStore()

  const c1 = DomainCollection.fromDocuments([{ doc: doc1, path: '/m1.md' }], store, { depth: 0 })
  const c2 = DomainCollection.fromDocuments([{ doc: doc2, path: '/m2.md' }], store, { depth: 0 })
  const merged = c1.merge(c2)

  assert({
    given: 'two non-overlapping collections',
    should: 'have combined size',
    actual: merged.size,
    expected: 2,
  })
})

test('DomainCollection.merge - deduplicates by path', () => {
  const doc1 = Document.fromMarkdown(md('title: Version A', '# A'))
  const doc2 = Document.fromMarkdown(md('title: Version B', '# B'))
  const store = createMockStore()

  const c1 = DomainCollection.fromDocuments([{ doc: doc1, path: '/same.md' }], store, { depth: 0 })
  const c2 = DomainCollection.fromDocuments([{ doc: doc2, path: '/same.md' }], store, { depth: 0 })
  const merged = c1.merge(c2)

  assert({
    given: 'overlapping paths',
    should: 'keep only one copy',
    actual: merged.size,
    expected: 1,
  })
})

test('DomainCollection.merge - keeps first collection on conflict', () => {
  const doc1 = Document.fromMarkdown(md('title: First', '# First'))
  const doc2 = Document.fromMarkdown(md('title: Second', '# Second'))
  const store = createMockStore()

  const c1 = DomainCollection.fromDocuments([{ doc: doc1, path: '/dup.md' }], store, { depth: 0 })
  const c2 = DomainCollection.fromDocuments([{ doc: doc2, path: '/dup.md' }], store, { depth: 0 })
  const merged = c1.merge(c2)

  assert({
    given: 'duplicate path',
    should: 'keep doc from first collection',
    actual: merged.toMarkdown().includes('# First'),
    expected: true,
  })
})

test('DomainCollection.merge - preserves entity types', () => {
  const alice = PersonDocument.fromMarkdown(md('name: Alice', '# Alice'))
  const acme = OrganizationDocument.fromMarkdown(md('name: Acme', '# Acme'))
  const meeting = Document.fromMarkdown(md('title: Meeting', '# Meeting'))
  const store = createMockStore()

  const c1 = DomainCollection.fromDocuments([{ doc: alice, path: '/people/Alice.md' }], store, { depth: 0 })
  const c2 = DomainCollection.fromDocuments(
    [
      { doc: acme, path: '/orgs/Acme.md' },
      { doc: meeting, path: '/time/meeting.md' },
    ],
    store,
    { depth: 0 },
  )
  const merged = c1.merge(c2)

  assert({
    given: 'merged collections with mixed types',
    should: 'have 1 person',
    actual: merged.people.length,
    expected: 1,
  })

  assert({
    given: 'merged collections with mixed types',
    should: 'have 1 org',
    actual: merged.orgs.length,
    expected: 1,
  })

  assert({
    given: 'merged collections with mixed types',
    should: 'have total size 3',
    actual: merged.size,
    expected: 3,
  })
})
