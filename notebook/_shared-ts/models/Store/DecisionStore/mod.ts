import * as path from 'node:path'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

interface DecisionEntry {
  value: DecisionDocument
  path: string
}

/**
 * Store for Decision documents with slug-based lookup.
 *
 * Decisions are stored at: {decisionsDir}/{year}/{month}/{slug}.md
 *
 * The store indexes by:
 * - Normalized name/slug (lowercase, trimmed)
 * - File path
 *
 * And provides filtering by pending/decided status.
 */
export default class DecisionStore {
  /** Normalized name → DecisionEntry */
  private byName: Map<string, DecisionEntry> = new Map()

  /** File path → DecisionDocument */
  private byPath: Map<string, DecisionDocument> = new Map()

  /** All entries for iteration */
  private entries: DecisionEntry[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Create an empty DecisionStore.
   */
  static empty(): DecisionStore {
    return new DecisionStore()
  }

  /**
   * Build a DecisionStore by walking the decisions directory structure.
   *
   * Expects structure: {decisionsDir}/{year}/{month}/{slug}.md
   *
   * @param decisionsDir - Base decisions directory (e.g., DIR_DECISIONS)
   */
  static async build(decisionsDir: string): Promise<DecisionStore> {
    const store = new DecisionStore()

    if (!(await exists(decisionsDir))) {
      return store
    }

    // Walk for all .md files
    for await (const entry of walk(decisionsDir, { exts: ['.md'], includeDirs: false })) {
      // Skip index files and hidden files
      if (entry.name === 'decisions.md') continue
      if (entry.name.startsWith('.')) continue

      try {
        const contents = await readTextFile(entry.path)
        const doc = DecisionDocument.fromMarkdown(contents)

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

        const decisionEntry: DecisionEntry = {
          value: doc,
          path: entry.path,
        }

        // Index by path
        store.byPath.set(entry.path, doc)

        // Index by name/slug
        const normalized = normalizeName(doc.name)
        if (normalized) {
          store.byName.set(normalized, decisionEntry)
        }

        // Add to entries list
        store.entries.push(decisionEntry)
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
   * Add or update a decision by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)

    const doc = DecisionDocument.fromMarkdown(contents)

    this.byPath.set(filePath, doc)

    if (!doc.name) return

    const decisionEntry: DecisionEntry = {
      value: doc,
      path: filePath,
    }

    const normalized = normalizeName(doc.name)
    if (normalized) {
      this.byName.set(normalized, decisionEntry)
    }

    this.entries.push(decisionEntry)
  }

  /**
   * Remove a decision by file path.
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
   * Find a decision by name/slug (case-insensitive).
   * Returns the entry with the document and file path.
   */
  find(name: string): DecisionEntry | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a decision by file path.
   */
  findByPath(filePath: string): DecisionDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all decisions as a collection.
   */
  getAll(): Collection<DecisionDocument> {
    const docs = this.entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'decision')
  }

  /**
   * Get all pending decisions (no decided date).
   */
  getPending(): Collection<DecisionDocument> {
    const docs = this.entries.filter((e) => e.value.isPending).map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'decision')
  }

  /**
   * Get all decided decisions (has decided date).
   */
  getDecided(): Collection<DecisionDocument> {
    const docs = this.entries.filter((e) => !e.value.isPending).map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'decision')
  }

  /**
   * Get all indexed names.
   */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /**
   * Number of decisions.
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
