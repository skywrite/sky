import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { Collection, Document } from '#shared/models/Markdown/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import type { StoreError, StoreWarning } from '../types.ts'

/** Pattern to match DD/subpath */
const REGEX_DD = /^(?<day>0[1-9]|[12][0-9]|3[01])\/(?<subpath>.+)$/

/** Pattern to match MM-DD/subpath */
const REGEX_MMDD = /^(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01])\/(?<subpath>.+)$/

/** Pattern to match YYYY-MM-DD/subpath */
const REGEX_YMD = /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01])\/(?<subpath>.+)$/

/**
 * Store for plain Markdown documents indexed by path.
 *
 * Unlike PeopleStore or OrgStore, this doesn't do name-based lookup.
 * It simply stores documents by their file path for later retrieval.
 *
 * Build is async (walks directories), lookups are sync (objects pre-loaded).
 */
export default class DocumentStore {
  /** File path → Document */
  private byPath: Map<string, Document> = new Map()

  /** Base directories the store was built from */
  private baseDirs: string[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Build a DocumentStore by walking directories.
   *
   * @param dirs - Directories to walk
   */
  static async build(dirs: string[]): Promise<DocumentStore> {
    const store = new DocumentStore()
    store.baseDirs = dirs

    for (const dir of dirs) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        try {
          const contents = await readTextFile(entry.path)
          const doc = Document.fromMarkdown(contents)

          // Check for yaml errors
          if (doc.yamlError) {
            store._warnings.push({
              path: entry.path,
              warning: `YAML error: ${doc.yamlError}`,
            })
          }

          // Index by path
          store.byPath.set(entry.path, doc)
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
   * Add or update a document by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    const doc = Document.fromMarkdown(contents)
    this.byPath.set(filePath, doc)
  }

  /**
   * Remove a document by file path.
   */
  delete(filePath: string): void {
    this.byPath.delete(filePath)
  }

  /**
   * Find a document by file path.
   */
  findByPath(filePath: string): Document | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all documents as a collection.
   */
  getAll(): Collection<Document> {
    const docs = Array.from(this.byPath.entries()).map(([filePath, doc]) => ({
      doc,
      path: filePath,
    }))
    return Collection.from(docs)
  }

  /**
   * Get all file paths.
   */
  get paths(): string[] {
    return Array.from(this.byPath.keys())
  }

  /**
   * Number of documents.
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

  /**
   * Resolve a time reference to a Document.
   * Returns both the document and its file path.
   *
   * Ref formats:
   * - `DD/subpath` - day only, uses context year and month
   * - `MM-DD/subpath` - month and day, uses context year
   * - `YYYY-MM-DD/subpath` - full date, ignores context
   *
   * @param ref - The reference string (e.g., "09-30/actions/messages/email_foo")
   * @param context - Date context for missing year/month
   * @returns The Document and path if found, undefined otherwise
   *
   * @example
   * // From a file dated 2025-02-10
   * store.resolveRef('08/meeting', { year: 2025, month: 2 })  // Feb 8, 2025
   * store.resolveRef('01-15/notes', { year: 2025 })          // Jan 15, 2025
   * store.resolveRef('2024-12-25/event', {})                 // Dec 25, 2024
   */
  resolveRef(ref: string, context: { year?: number; month?: number }): { value: Document; path: string } | undefined {
    if (this.baseDirs.length === 0) return undefined

    // Try YYYY-MM-DD/subpath first (most specific)
    let match = ref.match(REGEX_YMD)
    if (match?.groups) {
      const { year, month, day, subpath } = match.groups
      return this.findByRef(parseInt(year, 10), parseInt(month, 10), parseInt(day, 10), subpath)
    }

    // Try MM-DD/subpath
    match = ref.match(REGEX_MMDD)
    if (match?.groups) {
      const { month, day, subpath } = match.groups
      const year = context.year
      if (!year) return undefined
      return this.findByRef(year, parseInt(month, 10), parseInt(day, 10), subpath)
    }

    // Try DD/subpath
    match = ref.match(REGEX_DD)
    if (match?.groups) {
      const { day, subpath } = match.groups
      const year = context.year
      const month = context.month
      if (!year || !month) return undefined
      return this.findByRef(year, month, parseInt(day, 10), subpath)
    }

    return undefined
  }

  /**
   * Find a document by date components and subpath.
   */
  private findByRef(
    year: number,
    month: number,
    day: number,
    subpath: string,
  ): { value: Document; path: string } | undefined {
    const date = new PlainDate(year, month, day)
    const datePath = dayDir(date)

    // Try each base directory
    for (const baseDir of this.baseDirs) {
      // Try with .md extension
      let fullPath = path.join(baseDir, datePath, subpath + '.md')
      let doc = this.byPath.get(fullPath)
      if (doc) return { value: doc, path: fullPath }

      // Try without .md extension (in case subpath already has it)
      fullPath = path.join(baseDir, datePath, subpath)
      doc = this.byPath.get(fullPath)
      if (doc) return { value: doc, path: fullPath }
    }

    return undefined
  }
}
