import type PersonDocument from '../document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type TagSet from '#shared/models/TagSet/mod.ts'
import type ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import type { PlainDate, PlainYear, PlainYearMonth } from '#universal/dates/nbdt/mod.ts'
import Organization from '#shared/models/Organization/model/mod.ts'
import RelSet from '#shared/models/RelSet/mod.ts'

/**
 * Domain class for Person that composes PersonDocument + MarkdownStore.
 *
 * Provides sugar methods for relationship resolution while delegating
 * commonly-used data properties to the underlying document.
 *
 * Status 2026-07-26: nothing constructs this class — the model layer has no entry
 * point yet. Before building on it or deleting it, read ../../README.md.
 */
export default class Person {
  readonly doc: PersonDocument
  private store: MarkdownStore

  constructor(doc: PersonDocument, store: MarkdownStore) {
    this.doc = doc
    this.store = store
  }

  static from(doc: PersonDocument, store: MarkdownStore): Person {
    return new Person(doc, store)
  }

  // Delegated data properties
  get name(): string {
    return this.doc.name
  }

  get names(): string[] {
    return this.doc.names
  }

  get slug(): string {
    return this.doc.slug
  }

  get slugPreserveCase(): string {
    return this.doc.slugPreserveCase
  }

  get alt(): string | undefined {
    return this.doc.alt
  }

  get email(): {
    personal?: string | string[]
    business?: string | string[]
  } {
    return this.doc.email
  }

  get title(): string | undefined {
    return this.doc.title
  }

  get location(): string | undefined {
    return this.doc.location
  }

  get met(): PlainDate | PlainYearMonth | PlainYear | undefined {
    return this.doc.met
  }

  get sites(): ImmutableSet<string> {
    return this.doc.sites
  }

  get tags(): TagSet {
    return this.doc.tags
  }

  get markdown(): string {
    return this.doc.markdown
  }

  /**
   * Structured organizations with current and past arrays resolved to Organization objects.
   * Only includes those that successfully resolve to Organization type.
   */
  get orgs(): { current: Organization[]; past: Organization[] } {
    const resolveOrgs = (names: string[]): Organization[] =>
      names
        .map((name) => this.store.resolve(name))
        .filter((resolved) => resolved.type === 'org')
        .map((resolved) => Organization.from(resolved.value, this.store))

    return {
      current: resolveOrgs(this.doc.orgs.current),
      past: resolveOrgs(this.doc.orgs.past),
    }
  }

  // Relationship resolution - org resolves to Organization | undefined
  get org(): Organization | undefined {
    const orgRaw = this.doc.org
    if (!orgRaw) return undefined

    const resolved = this.store.resolve(orgRaw)
    if (resolved.type === 'org') {
      return Organization.from(resolved.value, this.store)
    }
    return undefined
  }

  get relSet(): RelSet {
    return RelSet.from(this.store.resolveAll(this.doc.rel))
  }
}
