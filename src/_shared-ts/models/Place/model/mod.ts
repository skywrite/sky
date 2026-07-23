import type PlaceDocument from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type { PlaceLocation } from '../document/types.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * Domain class for Place that composes PlaceDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 */
export default class Place {
  readonly doc: PlaceDocument
  private store: MarkdownStore

  constructor(doc: PlaceDocument, store: MarkdownStore) {
    this.doc = doc
    this.store = store
  }

  static from(doc: PlaceDocument, store: MarkdownStore): Place {
    return new Place(doc, store)
  }

  // Delegated data properties
  get name(): string {
    return this.doc.name
  }

  get type(): string {
    return this.doc.type
  }

  get address(): string | undefined {
    return this.doc.address
  }

  get site(): string | undefined {
    return this.doc.site
  }

  get googleMapsUrl(): string | undefined {
    return this.doc.googleMapsUrl
  }

  get location(): PlaceLocation | undefined {
    return this.doc.location
  }

  get tags(): TagSet {
    return this.doc.tags
  }

  get markdown(): string {
    return this.doc.markdown
  }

  toPath(): string {
    return this.doc.toPath()
  }

  toLocationDisplayString(): string {
    return this.doc.toLocationDisplayString()
  }

  get relSet(): RelSet {
    return RelSet.from(this.store.resolveAll(this.doc.rel))
  }
}
