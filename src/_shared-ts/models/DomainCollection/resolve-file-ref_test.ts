import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'
import { assert, test } from '#test'
import DomainCollection from './mod.ts'

function md(yaml: string, body: string): string {
  return `---\n${yaml}\n---\n${body}`
}

function createMockStore(): MarkdownStore {
  return {
    resolve(raw: string): ResolvedRef {
      // Simulate a ./ref resolving as 'file' type
      if (raw.startsWith('./')) {
        return { type: 'file', value: null, path: `/resolved${raw.slice(1)}.md`, raw }
      }
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

test('DomainCollection.fromDocument - skips file refs in rel field', () => {
  const store = createMockStore()
  const doc = Document.fromMarkdown(md('title: Slack msg\nrel:\n  - ./email_Nick-to-JP', '# Content'))
  const collection = DomainCollection.fromDocument(doc, '/messages/slack.md', store)

  assert({
    given: 'document with ./ref in rel field',
    should: 'have size 1 (root doc only, file ref skipped)',
    actual: collection.size,
    expected: 1,
  })

  assert({
    given: 'document with ./ref in rel field',
    should: 'have 0 people',
    actual: collection.people.length,
    expected: 0,
  })

  assert({
    given: 'document with ./ref in rel field',
    should: 'have 0 orgs',
    actual: collection.orgs.length,
    expected: 0,
  })
})

test('DomainCollection.fromRefs - skips file refs', () => {
  const store = createMockStore()
  const refs: ResolvedRef[] = [
    { type: 'file', value: null, path: '/resolved/email.md', raw: './email' },
    { type: 'url', value: new URL('https://example.com'), raw: 'https://example.com' },
    { type: 'unresolved', value: null, raw: 'Unknown' },
  ]

  const collection = DomainCollection.fromRefs(refs, store)

  assert({
    given: 'file, url, and unresolved refs',
    should: 'have size 0 (all skipped)',
    actual: collection.size,
    expected: 0,
  })
})
