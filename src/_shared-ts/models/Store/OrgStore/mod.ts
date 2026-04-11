import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

/**
 * Store for Organization documents with name-based lookup.
 *
 * Indexes by normalized name (lowercase, trimmed) and by slug.
 *
 * Build is async (walks directories), lookups are sync (objects pre-loaded).
 */
export default class OrgStore {
  /** Normalized name → { org, path } */
  private byName: Map<string, { value: OrganizationDocument; path: string }> = new Map()

  /** Slug → { org, path } */
  private bySlug: Map<string, { value: OrganizationDocument; path: string }> = new Map()

  /** File path → Organization (for findByPath) */
  private byPath: Map<string, OrganizationDocument> = new Map()

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Build an OrgStore by walking directories.
   *
   * @param dirs - Directories to walk (e.g., DIR_ORGS)
   */
  static async build(dirs: string[]): Promise<OrgStore> {
    const store = new OrgStore()

    for (const dir of dirs) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        try {
          const contents = await readTextFile(entry.path)
          const org = OrganizationDocument.fromMarkdown(contents)

          // Check for yaml errors
          if (org.yamlError) {
            store._warnings.push({
              path: entry.path,
              warning: `YAML error: ${org.yamlError}`,
            })
          }

          // Check for missing name
          if (!org.name) {
            store._warnings.push({
              path: entry.path,
              warning: 'Missing name field',
            })
            // Still index by path even without name
            store.byPath.set(entry.path, org)
            continue
          }

          // Index by path
          store.byPath.set(entry.path, org)

          // Index by name (with path)
          const normalized = normalizeName(org.name)
          if (normalized) {
            store.byName.set(normalized, { value: org, path: entry.path })
          }

          // Index by slug (with path)
          if (org.slug) {
            store.bySlug.set(org.slug.toLowerCase(), { value: org, path: entry.path })
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
   * Add or update an organization by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)

    const org = OrganizationDocument.fromMarkdown(contents)

    this.byPath.set(filePath, org)

    if (!org.name) return

    const normalized = normalizeName(org.name)
    if (normalized) {
      this.byName.set(normalized, { value: org, path: filePath })
    }

    if (org.slug) {
      this.bySlug.set(org.slug.toLowerCase(), { value: org, path: filePath })
    }
  }

  /**
   * Remove an organization by file path.
   */
  delete(filePath: string): void {
    const existing = this.byPath.get(filePath)
    if (!existing) return

    // Remove name index entry pointing to this path
    for (const [key, entry] of this.byName) {
      if (entry.path === filePath) {
        this.byName.delete(key)
      }
    }

    // Remove slug index entry pointing to this path
    for (const [key, entry] of this.bySlug) {
      if (entry.path === filePath) {
        this.bySlug.delete(key)
      }
    }

    this.byPath.delete(filePath)
  }

  /**
   * Find an organization by name (case-insensitive).
   * Returns both the org and its file path.
   */
  find(name: string): { value: OrganizationDocument; path: string } | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find an organization by slug.
   * Returns both the org and its file path.
   */
  findBySlug(slug: string): { value: OrganizationDocument; path: string } | undefined {
    return this.bySlug.get(slug.toLowerCase())
  }

  /**
   * Find an organization by file path.
   */
  findByPath(filePath: string): OrganizationDocument | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all organizations as a collection.
   */
  getAll(): Collection<OrganizationDocument> {
    const docs = Array.from(this.byPath.entries()).map(([filePath, doc]) => ({
      doc,
      path: filePath,
    }))
    return Collection.from(docs, 'org')
  }

  /**
   * Get all indexed names.
   */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /**
   * Number of organizations.
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
