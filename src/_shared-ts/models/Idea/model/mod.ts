import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type IdeaDocument from '../document/mod.ts'

/**
 * Domain class for Idea that composes IdeaDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 *
 * Status 2026-07-26: nothing constructs this class — the model layer has no entry
 * point yet. Before building on it or deleting it, read ../../README.md.
 */
export default class Idea {
  readonly doc: IdeaDocument
  private store: MarkdownStore

  constructor(doc: IdeaDocument, store: MarkdownStore) {
    this.doc = doc
    this.store = store
  }

  static from(doc: IdeaDocument, store: MarkdownStore): Idea {
    return new Idea(doc, store)
  }

  // Delegated data properties
  get name(): string {
    return this.doc.name
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
