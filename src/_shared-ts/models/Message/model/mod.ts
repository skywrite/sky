import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import Person from '#shared/models/Person/model/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type { When } from '#universal/dates/nbdt/mod.ts'
import type MessageDocument from '../document/mod.ts'

/**
 * Domain class for Message that composes MessageDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 *
 * Status 2026-07-26: nothing constructs this class — the model layer has no entry
 * point yet. Before building on it or deleting it, read ../../README.md.
 */
export default class Message {
  constructor(
    readonly doc: MessageDocument,
    private store: MarkdownStore,
  ) {}

  static from(doc: MessageDocument, store: MarkdownStore): Message {
    return new Message(doc, store)
  }

  // Delegated data properties
  get when(): When {
    return this.doc.when
  }

  get medium(): string {
    return this.doc.medium
  }

  get summary(): string | undefined {
    return this.doc.summary
  }

  get tags(): TagSet {
    return this.doc.tags
  }

  get markdown(): string {
    return this.doc.markdown
  }

  // Relationship resolution - from resolves to Person | undefined
  get from(): Person | undefined {
    const fromRaw = this.doc.yaml['from']
    if (typeof fromRaw !== 'string') return undefined

    const resolved = this.store.resolve(fromRaw)
    if (resolved.type === 'person') {
      return Person.from(resolved.value, this.store)
    }
    return undefined
  }

  // Relationship resolution - to resolves to Person[]
  get to(): Person[] {
    const toRaw = this.doc.yaml['to']
    const rawStrings = Array.isArray(toRaw) ? toRaw : toRaw ? [toRaw] : []
    return this.store
      .resolveAll(rawStrings)
      .filter((r): r is Extract<typeof r, { type: 'person' }> => r.type === 'person')
      .map((r) => Person.from(r.value, this.store))
  }

  get relSet(): RelSet {
    return RelSet.from(this.store.resolveAll(this.doc.rel))
  }
}
