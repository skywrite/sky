import type DayDocument from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * Domain class for Day that composes DayDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 */
export default class Day {
  constructor(
    readonly doc: DayDocument,
    private store: MarkdownStore,
  ) {}

  static from(doc: DayDocument, store: MarkdownStore): Day {
    return new Day(doc, store)
  }

  // Delegated data properties
  get day(): PlainDate {
    return this.doc.day
  }

  get YMD(): string {
    return this.doc.YMD
  }

  get dayWordShort(): string {
    return this.doc.dayWordShort
  }

  get perfect(): boolean {
    return this.doc.perfect
  }

  get started(): ZonedDateTime | undefined {
    return this.doc.started
  }

  get ended(): ZonedDateTime | undefined {
    return this.doc.ended
  }

  get timezone(): string {
    return this.doc.timezone
  }

  get lists(): ItemList[] {
    return this.doc.lists
  }

  get tags(): TagSet {
    return this.doc.tags
  }

  get markdown(): string {
    return this.doc.markdown
  }

  // Relationship resolution
  get relSet(): RelSet {
    return RelSet.from(this.store.resolveAll(this.doc.rel))
  }
}
