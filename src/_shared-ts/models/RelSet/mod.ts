import type { Document } from '#shared/models/Markdown/mod.ts'
import type OrganizationDocument from '#shared/models/Organization/mod.ts'
import type PersonDocument from '#shared/models/Person/mod.ts'
import type PlaceDocument from '#shared/models/Place/mod.ts'
import type ProjectDocument from '#shared/models/Project/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'

/** Collection of resolved references with typed accessors */
export default class RelSet {
  private refs: ResolvedRef[]

  constructor(refs: ResolvedRef[] = []) {
    this.refs = refs
  }

  static from(refs: Iterable<ResolvedRef>): RelSet {
    return new RelSet(Array.from(refs))
  }

  get size(): number {
    return this.refs.length
  }

  get people(): { value: PersonDocument; path: string; raw: string }[] {
    return this.refs
      .filter((ref): ref is Extract<ResolvedRef, { type: 'person' }> => ref.type === 'person')
      .map((ref) => ({ value: ref.value, path: ref.path, raw: ref.raw }))
  }

  get orgs(): { value: OrganizationDocument; path: string; raw: string }[] {
    return this.refs
      .filter((ref): ref is Extract<ResolvedRef, { type: 'org' }> => ref.type === 'org')
      .map((ref) => ({ value: ref.value, path: ref.path, raw: ref.raw }))
  }

  get projects(): { value: ProjectDocument; path: string; raw: string }[] {
    return this.refs
      .filter((ref): ref is Extract<ResolvedRef, { type: 'project' }> => ref.type === 'project')
      .map((ref) => ({ value: ref.value, path: ref.path, raw: ref.raw }))
  }

  get places(): { value: PlaceDocument; path: string; raw: string }[] {
    return this.refs
      .filter((ref): ref is Extract<ResolvedRef, { type: 'place' }> => ref.type === 'place')
      .map((ref) => ({ value: ref.value, path: ref.path, raw: ref.raw }))
  }

  get documents(): { value: Document; path: string; raw: string }[] {
    return this.refs
      .filter((ref): ref is Extract<ResolvedRef, { type: 'document' }> => ref.type === 'document')
      .map((ref) => ({ value: ref.value, path: ref.path, raw: ref.raw }))
  }

  get urls(): { value: URL; raw: string }[] {
    return this.refs
      .filter((ref): ref is Extract<ResolvedRef, { type: 'url' }> => ref.type === 'url')
      .map((ref) => ({ value: ref.value, raw: ref.raw }))
  }

  get unresolved(): string[] {
    return this.refs.filter((ref) => ref.type === 'unresolved').map((ref) => ref.raw)
  }

  get paths(): string[] {
    return this.refs
      .filter(
        (ref): ref is Extract<ResolvedRef, { type: 'person' | 'org' | 'project' | 'place' | 'document' }> =>
          ref.type === 'person' ||
          ref.type === 'org' ||
          ref.type === 'project' ||
          ref.type === 'place' ||
          ref.type === 'document',
      )
      .map((ref) => ref.path)
  }

  get allResolved(): boolean {
    return this.refs.every((ref) => ref.type !== 'unresolved')
  }

  get hasUnresolved(): boolean {
    return this.refs.some((ref) => ref.type === 'unresolved')
  }

  toArray(): ResolvedRef[] {
    return [...this.refs]
  }

  [Symbol.iterator](): Iterator<ResolvedRef> {
    return this.refs[Symbol.iterator]()
  }
}
