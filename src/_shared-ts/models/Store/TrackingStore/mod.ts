import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

export type TrackingStatus = 'active' | 'archived'

interface TrackingEntry {
  value: TrackingDocument
  path: string
}

/**
 * Store for Tracking definition documents with slug-based lookup.
 *
 * Definitions are stored at: {trackingDir}/{status}/{slug}.md
 *
 * Status is derived from the file path:
 * - /active/   → active
 * - /archived/ → archived (definitions are never deleted, only archived)
 */
export default class TrackingStore {
  /** Normalized name → TrackingEntry */
  private byName: Map<string, TrackingEntry> = new Map()

  /** File path → TrackingDocument */
  private byPath: Map<string, TrackingDocument> = new Map()

  /** All entries for iteration */
  private entries: TrackingEntry[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Create an empty TrackingStore.
   */
  static empty(): TrackingStore {
    return new TrackingStore()
  }

  /**
   * Build a TrackingStore by walking the tracking directory structure.
   */
  static async build(trackingDir: string): Promise<TrackingStore> {
    const store = new TrackingStore()

    if (!(await exists(trackingDir))) {
      return store
    }

    for await (const entry of walk(trackingDir, { exts: ['.md'], includeDirs: false })) {
      if (entry.name.startsWith('.')) continue

      try {
        const contents = await readTextFile(entry.path)
        const doc = TrackingDocument.fromMarkdown(contents)

        if (doc.yamlError) {
          store._warnings.push({
            path: entry.path,
            warning: `YAML error: ${doc.yamlError}`,
          })
        }

        if (!doc.name) {
          store._warnings.push({
            path: entry.path,
            warning: 'Missing name field',
          })
          store.byPath.set(entry.path, doc)
          continue
        }

        const trackingEntry: TrackingEntry = {
          value: doc,
          path: entry.path,
        }

        store.byPath.set(entry.path, doc)

        const normalized = normalizeName(doc.name)
        if (normalized) {
          store.byName.set(normalized, trackingEntry)
        }

        store.entries.push(trackingEntry)
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
   * Detect status from file path.
   */
  static statusFromPath(filePath: string): TrackingStatus {
    if (filePath.includes('/archived/')) return 'archived'
    return 'active'
  }

  /**
   * Add or update a tracking definition by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)

    const doc = TrackingDocument.fromMarkdown(contents)

    this.byPath.set(filePath, doc)

    if (!doc.name) return

    const trackingEntry: TrackingEntry = {
      value: doc,
      path: filePath,
    }

    const normalized = normalizeName(doc.name)
    if (normalized) {
      this.byName.set(normalized, trackingEntry)
    }

    this.entries.push(trackingEntry)
  }

  /**
   * Remove a tracking definition by file path.
   */
  delete(filePath: string): void {
    this.byPath.delete(filePath)

    for (const [key, entry] of this.byName) {
      if (entry.path === filePath) {
        this.byName.delete(key)
      }
    }

    const idx = this.entries.findIndex((e) => e.path === filePath)
    if (idx !== -1) {
      this.entries.splice(idx, 1)
    }
  }

  /**
   * Find a tracking definition by name/slug (case-insensitive).
   */
  find(name: string): TrackingEntry | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a tracking definition by file path.
   */
  findByPath(filePath: string): TrackingDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all tracking definitions as a collection.
   */
  getAll(): Collection<TrackingDocument> {
    const docs = this.entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'tracking')
  }

  /** Get all active tracking definitions. */
  getActive(): Collection<TrackingDocument> {
    const docs = this.entries
      .filter((e) => TrackingStore.statusFromPath(e.path) === 'active')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'tracking')
  }

  /** Get all archived tracking definitions. */
  getArchived(): Collection<TrackingDocument> {
    const docs = this.entries
      .filter((e) => TrackingStore.statusFromPath(e.path) === 'archived')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'tracking')
  }

  /** Get all indexed names. */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /** Number of tracking definitions. */
  get size(): number {
    return this.entries.length
  }

  /** Errors encountered during build. */
  get errors(): StoreError[] {
    return this._errors
  }

  /** Warnings for files that parsed but have issues. */
  get warnings(): StoreWarning[] {
    return this._warnings
  }
}
