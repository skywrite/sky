import type ProjectDocument from '../document/mod.ts'
import type { ProjectStatus } from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * ProjectDocument + MarkdownStore for relationship resolution.
 *
 * Status 2026-07-26: nothing constructs this class — the model layer has no entry
 * point yet. Before building on it or deleting it, read ../../README.md.
 */
export default class Project {
  readonly doc: ProjectDocument
  private store: MarkdownStore

  constructor(doc: ProjectDocument, store: MarkdownStore) {
    this.doc = doc
    this.store = store
  }

  static from(doc: ProjectDocument, store: MarkdownStore): Project {
    return new Project(doc, store)
  }

  get name(): string {
    return this.doc.name
  }

  get status(): ProjectStatus {
    return this.doc.status
  }

  get created(): PlainDate | undefined {
    return this.doc.created
  }

  get updated(): PlainDate | undefined {
    return this.doc.updated
  }

  get closedReason(): string | undefined {
    return this.doc.closedReason
  }

  get tags(): TagSet {
    return this.doc.tags
  }

  get rel(): ImmutableSet<string> {
    return this.doc.rel
  }

  get markdown(): string {
    return this.doc.markdown
  }

  get open(): boolean {
    return this.doc.open
  }

  get closed(): boolean {
    return this.doc.closed
  }

  get relSet(): RelSet {
    return RelSet.from(this.store.resolveAll(this.doc.rel))
  }
}
