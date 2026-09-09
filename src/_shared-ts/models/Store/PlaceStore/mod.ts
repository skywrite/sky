import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import Collection from '#shared/models/Markdown/Collection/mod.ts'
import PlaceDocument, { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

export interface PlaceEntry {
  value: PlaceDocument
  path: string
  /** The place path without file extension, e.g., "places/US/NY/New-York/Manhattan/drink/Ty-Bar" */
  placePath: string
}

/**
 * Store for Place documents with name-based and path-based lookup.
 *
 * Places have a hierarchical directory structure:
 *   {placesDir}/{country}/{region?}/{city?}/{subcity?}/{type}/{Name}.md
 *
 * The store indexes by:
 * - Normalized name (lowercase, trimmed)
 * - File path
 * - Place path (the path prefix like "places/US/NY/New-York/drink/Ty-Bar")
 *
 * Build is async (walks directories), lookups are sync (objects pre-loaded).
 */
export default class PlaceStore {
  /** Names can belong to several places; an ambiguous lookup never picks one. */
  private byName: Map<string, PlaceEntry[]> = new Map()

  /** File path → PlaceDocument */
  private byPath: Map<string, PlaceDocument> = new Map()

  /** Place path → PlaceEntry (for rel: resolution) */
  private byPlacePath: Map<string, PlaceEntry[]> = new Map()

  /** All entries for iteration */
  private entries: PlaceEntry[] = []

  /** Base directory for computing placePath */
  private placesDir: string = ''

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Create an empty PlaceStore (for when no placesDir is configured).
   */
  static empty(): PlaceStore {
    return new PlaceStore()
  }

  /**
   * Build a PlaceStore by walking the places directory.
   *
   * @param placesDir - Base places directory (e.g., DIR_PLACES_LOCATIONS)
   */
  static async build(placesDir: string): Promise<PlaceStore> {
    const store = new PlaceStore()
    store.placesDir = placesDir

    for await (const entry of walk(placesDir)) {
      if (path.extname(entry.path) !== '.md') continue

      try {
        const contents = await readTextFile(entry.path)
        store.set(entry.path, contents)
      } catch (err) {
        store._errors.push({
          path: entry.path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return store
  }

  /**
   * Add or update a place by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    if (this.byPath.has(filePath)) this.delete(filePath)

    const doc = PlaceDocument.fromMarkdown(contents)
    this.byPath.set(filePath, doc)
    if (doc.yamlError) this._warnings.push({ path: filePath, warning: `YAML error: ${doc.yamlError}` })
    if (!doc.name) {
      this._warnings.push({ path: filePath, warning: 'Missing name field' })
      return
    }
    if (!this.placesDir) return
    const fileRef = normalizePlaceRef(`places/${path.relative(this.placesDir, filePath)}`)
    if (!fileRef) return
    if (doc.yaml['ref'] !== undefined && !doc.ref) {
      this._warnings.push({ path: filePath, warning: 'Invalid place ref' })
    }
    const placePath = doc.ref ?? fileRef

    const placeEntry: PlaceEntry = {
      value: doc,
      path: filePath,
      placePath,
    }

    for (const name of new Set([doc.name, ...doc.aliases].map(normalizeName))) {
      this.byName.set(name, [...(this.byName.get(name) ?? []), placeEntry])
    }
    for (const ref of new Set([placePath, fileRef, ...doc.refAliases].map((r) => r.toLowerCase()))) {
      this.byPlacePath.set(ref, [...(this.byPlacePath.get(ref) ?? []), placeEntry])
    }
    this.entries.push(placeEntry)
  }

  /**
   * Remove a place by file path.
   */
  delete(filePath: string): void {
    this.byPath.delete(filePath)
    this._warnings = this._warnings.filter((w) => w.path !== filePath)
    for (const index of [this.byName, this.byPlacePath]) {
      for (const [key, entries] of index) {
        const remaining = entries.filter((entry) => entry.path !== filePath)
        if (remaining.length) index.set(key, remaining)
        else index.delete(key)
      }
    }

    const idx = this.entries.findIndex((e) => e.path === filePath)
    if (idx !== -1) {
      this.entries.splice(idx, 1)
    }
  }

  /**
   * Find a place by name (case-insensitive).
   * Returns the entry with the document and file path.
   */
  find(name: string): PlaceEntry | undefined {
    const matches = this.byName.get(normalizeName(name))
    return matches?.length === 1 ? matches[0] : undefined
  }

  /**
   * Find a place by place path (e.g., "places/US/NY/New-York/drink/Ty-Bar").
   * Returns the entry with the document and file path.
   */
  findByPlacePath(placePath: string): PlaceEntry | undefined {
    const ref = normalizePlaceRef(placePath)
    const matches = ref ? this.byPlacePath.get(ref.toLowerCase()) : undefined
    return matches?.length === 1 ? matches[0] : undefined
  }

  /** Whether a ref is claimed, including a collision that needs repair. */
  hasPlacePath(placePath: string): boolean {
    const ref = normalizePlaceRef(placePath)
    return !!ref && this.byPlacePath.has(ref.toLowerCase())
  }

  /** Iterate by identity, so duplicate names never hide records from search. */
  getEntries(): readonly PlaceEntry[] {
    return this.entries
  }

  get directory(): string | undefined {
    return this.placesDir || undefined
  }

  /**
   * Find a place by file path.
   */
  findByPath(filePath: string): PlaceDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all places as a collection.
   */
  getAll(): Collection<PlaceDocument> {
    const docs = this.entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'place')
  }

  /**
   * Get all indexed names.
   */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /**
   * Get all place paths.
   */
  get placePaths(): string[] {
    return this.entries.map((entry) => entry.placePath)
  }

  /**
   * Number of places.
   */
  get size(): number {
    return this.entries.length
  }

  /**
   * Errors encountered during build.
   */
  get errors(): StoreError[] {
    return this._errors
  }

  /**
   * Warnings for files that parsed but have issues.
   */
  get warnings(): StoreWarning[] {
    return this._warnings
  }
}
