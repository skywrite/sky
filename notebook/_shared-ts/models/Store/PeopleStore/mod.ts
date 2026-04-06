import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

/**
 * Store for Person documents with name-based lookup.
 *
 * Indexes by normalized name (lowercase, trimmed). Supports multiple names
 * per person (aliases) - all names in Person.names are indexed to the same Person.
 *
 * Build is async (walks directories), lookups are sync (objects pre-loaded).
 */
export default class PeopleStore {
  /** Normalized name → { person, path } */
  private byName: Map<string, { value: PersonDocument; path: string }> = new Map()

  /** File path → Person (for findByPath) */
  private byPath: Map<string, PersonDocument> = new Map()

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Build a PeopleStore by walking directories.
   *
   * @param dirs - Directories to walk (e.g., DIR_PEOPLE, DIR_PEOPLE_OLD)
   */
  static async build(dirs: string[]): Promise<PeopleStore> {
    const store = new PeopleStore()

    for (const dir of dirs) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        try {
          const contents = await readTextFile(entry.path)
          const person = PersonDocument.fromMarkdown(contents)

          // Check for yaml errors
          if (person.yamlError) {
            store._warnings.push({
              path: entry.path,
              warning: `YAML error: ${person.yamlError}`,
            })
          }

          // Check for missing name
          if (person.names.length === 0) {
            store._warnings.push({
              path: entry.path,
              warning: 'Missing name field',
            })
            // Still index by path even without name
            store.byPath.set(entry.path, person)
            continue
          }

          // Index by path
          store.byPath.set(entry.path, person)

          // Index by all names (with path)
          for (const name of person.names) {
            const normalized = normalizeName(name)
            if (normalized) {
              store.byName.set(normalized, { value: person, path: entry.path })
            }
          }

          // Also index by alt name if present
          if (person.alt) {
            const normalized = normalizeName(person.alt)
            if (normalized) {
              store.byName.set(normalized, { value: person, path: entry.path })
            }
          }
        } catch (err) {
          // Collect errors for reporting
          store._errors.push({
            path: entry.path,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    return store
  }

  /**
   * Add or update a person by file path and raw contents.
   * Removes old index entries and re-indexes.
   */
  set(filePath: string, contents: string): void {
    // Remove old entries for this path
    this.delete(filePath)

    const person = PersonDocument.fromMarkdown(contents)

    // Index by path
    this.byPath.set(filePath, person)

    // Index by all names
    if (person.names.length === 0) return

    for (const name of person.names) {
      const normalized = normalizeName(name)
      if (normalized) {
        this.byName.set(normalized, { value: person, path: filePath })
      }
    }

    // Also index by alt name
    if (person.alt) {
      const normalized = normalizeName(person.alt)
      if (normalized) {
        this.byName.set(normalized, { value: person, path: filePath })
      }
    }
  }

  /**
   * Remove a person by file path.
   */
  delete(filePath: string): void {
    const existing = this.byPath.get(filePath)
    if (!existing) return

    // Remove all name index entries pointing to this path
    for (const [key, entry] of this.byName) {
      if (entry.path === filePath) {
        this.byName.delete(key)
      }
    }

    this.byPath.delete(filePath)
  }

  /**
   * Find a person by name (case-insensitive).
   * Returns both the person and their file path.
   */
  find(name: string): { value: PersonDocument; path: string } | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a person by file path.
   */
  findByPath(filePath: string): PersonDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all unique people (not aliases) as a collection.
   */
  getAll(): Collection<PersonDocument> {
    const docs = Array.from(this.byPath.entries()).map(([filePath, doc]) => ({
      doc,
      path: filePath,
    }))
    return Collection.from(docs, 'person')
  }

  /**
   * Get all indexed names (including aliases).
   */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /**
   * Number of unique people.
   */
  get size(): number {
    return this.byPath.size
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
