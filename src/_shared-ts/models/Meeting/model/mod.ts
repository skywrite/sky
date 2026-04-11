import type MeetingDocument from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import Person from '#shared/models/Person/model/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * Domain class for Meeting that composes MeetingDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 */
export default class Meeting {
  constructor(
    readonly doc: MeetingDocument,
    private store: MarkdownStore,
  ) {}

  static from(doc: MeetingDocument, store: MarkdownStore): Meeting {
    return new Meeting(doc, store)
  }

  // Delegated data properties
  get when(): PlainDateTime {
    return this.doc.when
  }

  get medium(): string {
    return this.doc.medium
  }

  get context(): string | undefined {
    return this.doc.context
  }

  get summary(): string | undefined {
    return this.doc.summary
  }

  get where(): string | undefined {
    return this.doc.where
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
