import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import PlaceDocument from '#shared/models/Place/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

interface PlaceEntry {
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
  /** Normalized name → PlaceEntry */
  private byName: Map<string, PlaceEntry> = new Map()

  /** File path → PlaceDocument */
  private byPath: Map<string, PlaceDocument> = new Map()

  /** Place path → PlaceEntry (for rel: resolution) */
  private byPlacePath: Map<string, PlaceEntry> = new Map()

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
        const doc = PlaceDocument.fromMarkdown(contents)

        // Check for yaml errors
        if (doc.yamlError) {
          store._warnings.push({
            path: entry.path,
            warning: `YAML error: ${doc.yamlError}`,
          })
        }

        // Check for missing name
        if (!doc.name) {
          store._warnings.push({
            path: entry.path,
            warning: 'Missing name field',
          })
          // Still index by path even without name
          store.byPath.set(entry.path, doc)
          continue
        }

        // Calculate place path from file path
        // e.g., /path/to/places/locations/US/NY/New-York/drink/Ty-Bar.md
        //    -> places/US/NY/New-York/drink/Ty-Bar
        const relativePath = entry.path.replace(placesDir, '').replace(/^\//, '')
        const placePath = 'places/' + relativePath.replace(/\.md$/, '').replace(/^locations\//, '')

        const placeEntry: PlaceEntry = {
          value: doc,
          path: entry.path,
          placePath,
        }

        // Index by path
        store.byPath.set(entry.path, doc)

        // Index by name
        const normalized = normalizeName(doc.name)
        if (normalized) {
          store.byName.set(normalized, placeEntry)
        }

        // Index by place path (for rel: resolution)
        store.byPlacePath.set(placePath, placeEntry)

        // Add to entries list
        store.entries.push(placeEntry)
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
    this.delete(filePath)

    const doc = PlaceDocument.fromMarkdown(contents)

    this.byPath.set(filePath, doc)

    if (!doc.name || !this.placesDir) return

    const relativePath = filePath.replace(this.placesDir, '').replace(/^\//, '')
    const placePath = 'places/' + relativePath.replace(/\.md$/, '').replace(/^locations\//, '')

    const placeEntry: PlaceEntry = {
      value: doc,
      path: filePath,
      placePath,
    }

    const normalized = normalizeName(doc.name)
    if (normalized) {
      this.byName.set(normalized, placeEntry)
    }

    this.byPlacePath.set(placePath, placeEntry)
    this.entries.push(placeEntry)
  }

  /**
   * Remove a place by file path.
   */
  delete(filePath: string): void {
    this.byPath.delete(filePath)

    for (const [key, entry] of this.byName) {
      if (entry.path === filePath) {
        this.byName.delete(key)
      }
    }

    for (const [key, entry] of this.byPlacePath) {
      if (entry.path === filePath) {
        this.byPlacePath.delete(key)
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
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a place by place path (e.g., "places/US/NY/New-York/drink/Ty-Bar").
   * Returns the entry with the document and file path.
   */
  findByPlacePath(placePath: string): PlaceEntry | undefined {
    return this.byPlacePath.get(placePath)
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
    return Array.from(this.byPlacePath.keys())
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
