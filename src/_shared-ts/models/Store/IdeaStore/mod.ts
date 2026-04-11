import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import IdeaDocument from '#shared/models/Idea/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

export type IdeaStatus = 'draft' | 'exploring' | 'actioned' | 'archived'

interface IdeaEntry {
  value: IdeaDocument
  path: string
}

/**
 * Store for Idea documents with slug-based lookup.
 *
 * Ideas are stored at: {ideasDir}/{year}/{status}/{month?}/{slug}.md
 *
 * Status is derived from the file path:
 * - /draft/     → draft (has month nesting for high-volume capture)
 * - /exploring/ → exploring
 * - /actioned/  → actioned
 * - /archived/  → archived
 */
export default class IdeaStore {
  /** Normalized name → IdeaEntry */
  private byName: Map<string, IdeaEntry> = new Map()

  /** File path → IdeaDocument */
  private byPath: Map<string, IdeaDocument> = new Map()

  /** All entries for iteration */
  private entries: IdeaEntry[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Create an empty IdeaStore.
   */
  static empty(): IdeaStore {
    return new IdeaStore()
  }

  /**
   * Build an IdeaStore by walking the ideas directory structure.
   */
  static async build(ideasDir: string): Promise<IdeaStore> {
    const store = new IdeaStore()

    if (!(await exists(ideasDir))) {
      return store
    }

    for await (const entry of walk(ideasDir, { exts: ['.md'], includeDirs: false })) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'ideas.md') continue

      try {
        const contents = await readTextFile(entry.path)
        const doc = IdeaDocument.fromMarkdown(contents)

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

        const ideaEntry: IdeaEntry = {
          value: doc,
          path: entry.path,
        }

        store.byPath.set(entry.path, doc)

        const normalized = normalizeName(doc.name)
        if (normalized) {
          store.byName.set(normalized, ideaEntry)
        }

        store.entries.push(ideaEntry)
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
  static statusFromPath(filePath: string): IdeaStatus {
    if (filePath.includes('/draft/')) return 'draft'
    if (filePath.includes('/exploring/')) return 'exploring'
    if (filePath.includes('/actioned/')) return 'actioned'
    if (filePath.includes('/archived/')) return 'archived'
    return 'draft'
  }

  /**
   * Add or update an idea by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)

    const doc = IdeaDocument.fromMarkdown(contents)

    this.byPath.set(filePath, doc)

    if (!doc.name) return

    const ideaEntry: IdeaEntry = {
      value: doc,
      path: filePath,
    }

    const normalized = normalizeName(doc.name)
    if (normalized) {
      this.byName.set(normalized, ideaEntry)
    }

    this.entries.push(ideaEntry)
  }

  /**
   * Remove an idea by file path.
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
   * Find an idea by name/slug (case-insensitive).
   */
  find(name: string): IdeaEntry | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find an idea by file path.
   */
  findByPath(filePath: string): IdeaDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all ideas as a collection.
   */
  getAll(): Collection<IdeaDocument> {
    const docs = this.entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'idea')
  }

  /** Get all draft ideas. */
  getDraft(): Collection<IdeaDocument> {
    const docs = this.entries
      .filter((e) => IdeaStore.statusFromPath(e.path) === 'draft')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'idea')
  }

  /** Get all exploring ideas. */
  getExploring(): Collection<IdeaDocument> {
    const docs = this.entries
      .filter((e) => IdeaStore.statusFromPath(e.path) === 'exploring')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'idea')
  }

  /** Get all actioned ideas. */
  getActioned(): Collection<IdeaDocument> {
    const docs = this.entries
      .filter((e) => IdeaStore.statusFromPath(e.path) === 'actioned')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'idea')
  }

  /** Get all archived ideas. */
  getArchived(): Collection<IdeaDocument> {
    const docs = this.entries
      .filter((e) => IdeaStore.statusFromPath(e.path) === 'archived')
      .map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'idea')
  }

  /** Get all indexed names. */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /** Number of ideas. */
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
