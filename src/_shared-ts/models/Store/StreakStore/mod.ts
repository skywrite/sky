import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

export type StreakStatus = 'active' | 'archived'

interface StreakEntry {
  value: StreakDocument
  path: string
}

/**
 * Store for Streak rule documents with slug-based lookup.
 *
 * Streaks are stored at: {streaksDir}/{status}/{slug}.md
 *
 * Status is derived from the file path:
 * - /active/   → active
 * - /archived/ → archived (streaks are never deleted, only archived)
 */
export default class StreakStore {
  /** Normalized name → StreakEntry */
  private byName: Map<string, StreakEntry> = new Map()

  /** File path → StreakDocument */
  private byPath: Map<string, StreakDocument> = new Map()

  /** All entries for iteration */
  private entries: StreakEntry[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Create an empty StreakStore.
   */
  static empty(): StreakStore {
    return new StreakStore()
  }

  /**
   * Build a StreakStore by walking the streaks directory structure.
   */
  static async build(streaksDir: string): Promise<StreakStore> {
    const store = new StreakStore()

    if (!(await exists(streaksDir))) {
      return store
    }

    for await (const entry of walk(streaksDir, { exts: ['.md'], includeDirs: false })) {
      if (entry.name.startsWith('.')) continue

      try {
        const contents = await readTextFile(entry.path)
        const doc = StreakDocument.fromMarkdown(contents)

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

        const streakEntry: StreakEntry = {
          value: doc,
          path: entry.path,
        }

        store.byPath.set(entry.path, doc)

        const normalized = normalizeName(doc.name)
        if (normalized) {
          store.byName.set(normalized, streakEntry)
        }

        store.entries.push(streakEntry)
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
  static statusFromPath(filePath: string): StreakStatus {
    if (filePath.includes('/archived/')) return 'archived'
    return 'active'
  }

  /**
   * Add or update a streak by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)

    const doc = StreakDocument.fromMarkdown(contents)

    this.byPath.set(filePath, doc)

    if (!doc.name) return

    const streakEntry: StreakEntry = {
      value: doc,
      path: filePath,
    }

    const normalized = normalizeName(doc.name)
    if (normalized) {
      this.byName.set(normalized, streakEntry)
    }

    this.entries.push(streakEntry)
  }

  /**
   * Remove a streak by file path.
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
   * Find a streak by name/slug (case-insensitive).
   */
  find(name: string): StreakEntry | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a streak by file path.
   */
  findByPath(filePath: string): StreakDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all streaks as a collection.
   */
  getAll(): Collection<StreakDocument> {
    const docs = this.entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'streak')
  }

  /** Get all active streaks. */
  getActive(): Collection<StreakDocument> {
    const docs = this.entries
      .filter((e) => StreakStore.statusFromPath(e.path) === 'active')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'streak')
  }

  /** Get all archived streaks. */
  getArchived(): Collection<StreakDocument> {
    const docs = this.entries
      .filter((e) => StreakStore.statusFromPath(e.path) === 'archived')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'streak')
  }

  /** Get all indexed names. */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /** Number of streaks. */
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
