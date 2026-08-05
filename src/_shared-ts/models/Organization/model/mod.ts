import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type OrganizationDocument from '../document/mod.ts'
import type { OrgKind } from '../document/mod.ts'

/**
 * Domain class for Organization that composes OrganizationDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 *
 * Status 2026-07-26: nothing constructs this class — the model layer has no entry
 * point yet. Before building on it or deleting it, read ../../README.md.
 */
export default class Organization {
  readonly doc: OrganizationDocument
  private store: MarkdownStore

  constructor(doc: OrganizationDocument, store: MarkdownStore) {
    this.doc = doc
    this.store = store
  }

  static from(doc: OrganizationDocument, store: MarkdownStore): Organization {
    return new Organization(doc, store)
  }

  // Delegated data properties
  get name(): string {
    return this.doc.name
  }

  get slug(): string {
    return this.doc.slug
  }

  get site(): string | undefined {
    return this.doc.site
  }

  get sector(): string {
    return this.doc.sector
  }

  get subcategory(): string {
    return this.doc.subcategory
  }

  get description(): string | undefined {
    return this.doc.description
  }

  get kind(): OrgKind {
    return this.doc.kind
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
