import type EventDocument from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import Person from '#shared/models/Person/model/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * Domain class for Event that composes EventDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 *
 * Status 2026-07-26: nothing constructs this class — the model layer has no entry
 * point yet. Before building on it or deleting it, read ../../README.md.
 */
export default class Event {
  constructor(
    readonly doc: EventDocument,
    private store: MarkdownStore,
  ) {}

  static from(doc: EventDocument, store: MarkdownStore): Event {
    return new Event(doc, store)
  }

  // Delegated data properties
  get what(): string {
    return this.doc.what
  }

  get when(): PlainDateTime | undefined {
    return this.doc.when
  }

  get where(): string | undefined {
    return this.doc.where
  }

  get context(): string | undefined {
    return this.doc.context
  }

  get tags(): TagSet {
    return this.doc.tags
  }

  get markdown(): string {
    return this.doc.markdown
  }

  // Relationship resolution - who resolves to Person[]
  get who(): Person[] {
    const whoRaw = this.doc.yaml['who']
    const rawStrings = Array.isArray(whoRaw) ? whoRaw : whoRaw ? [whoRaw] : []
    return this.store
      .resolveAll(rawStrings)
      .filter((r): r is Extract<typeof r, { type: 'person' }> => r.type === 'person')
      .map((r) => Person.from(r.value, this.store))
  }

  get relSet(): RelSet {
    return RelSet.from(this.store.resolveAll(this.doc.rel))
  }
}
