import type DecisionDocument from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * Domain class for Decision that composes DecisionDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 */
export default class Decision {
  constructor(
    readonly doc: DecisionDocument,
    private store: MarkdownStore,
  ) {}

  static from(doc: DecisionDocument, store: MarkdownStore): Decision {
    return new Decision(doc, store)
  }

  // Delegated data properties
  get name(): string {
    return this.doc.name
  }

  get identified(): ZonedDateTime | undefined {
    return this.doc.identified
  }

  get resolved(): ZonedDateTime | undefined {
    return this.doc.resolved
  }

  get isPending(): boolean {
    return this.doc.isPending
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
