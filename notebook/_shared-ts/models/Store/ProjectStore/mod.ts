import * as path from 'node:path'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import ProjectDocument, { PROJECT_STATUSES, type ProjectStatus } from '#shared/models/Project/mod.ts'
import { Collection, Document } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

interface ProjectEntry {
  value: ProjectDocument
  path: string
  projectDir: string
}

/**
 * Store for Project documents with name-based lookup and status filtering.
 *
 * Projects have a unique structure:
 *   {projectsDir}/{status}/{ProjectName}/_project/overview.md
 *
 * The store indexes by:
 * - Normalized name (lowercase, trimmed)
 * - File path
 *
 * And provides filtering by status.
 */
export default class ProjectStore {
  /** Normalized name → ProjectEntry */
  private byName: Map<string, ProjectEntry> = new Map()

  /** File path → Document (ProjectDocument for overview files, Document for others) */
  private byPath: Map<string, Document> = new Map()

  /** Status → ProjectEntry[] for fast filtering */
  private byStatus: Map<ProjectStatus, ProjectEntry[]> = new Map()

  /** All entries for iteration */
  private entries: ProjectEntry[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {
    // Initialize status maps
    for (const status of PROJECT_STATUSES) {
      this.byStatus.set(status, [])
    }
  }

  /**
   * Create an empty ProjectStore (for when no projectsDir is configured).
   */
  static empty(): ProjectStore {
    return new ProjectStore()
  }

  /**
   * Build a ProjectStore by walking the projects directory structure.
   *
   * Expects structure: {projectsDir}/{status}/{ProjectName}/_project/overview.md
   *
   * @param projectsDir - Base projects directory (e.g., DIR_PROJECTS)
   */
  static async build(projectsDir: string): Promise<ProjectStore> {
    const store = new ProjectStore()

    // Walk each status directory
    for (const status of PROJECT_STATUSES) {
      const statusDir = path.join(projectsDir, status)

      // Check if status directory exists
      if (!(await exists(statusDir))) {
        continue
      }

      // Walk all .md files in the status directory
      for await (const entry of walk(statusDir, { exts: ['.md'], includeDirs: false })) {
        const isOverview = entry.path.endsWith(path.join('_project', 'overview.md'))

        try {
          const contents = await readTextFile(entry.path)

          // Non-overview files: index as generic Document in byPath only
          if (!isOverview) {
            const doc = Document.fromMarkdown(contents)
            store.byPath.set(entry.path, doc)
            continue
          }

          // Overview files: parse as ProjectDocument and fully index
          const doc = ProjectDocument.fromMarkdown(contents)

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

          // Calculate project directory (parent of _project)
          // e.g., /path/to/projects/open/MyProject/_project/overview.md
          //    -> /path/to/projects/open/MyProject
          const projectDir = path.dirname(path.dirname(entry.path))

          const projectEntry: ProjectEntry = {
            value: doc,
            path: entry.path,
            projectDir,
          }

          // Index by path
          store.byPath.set(entry.path, doc)

          // Index by name
          const normalized = normalizeName(doc.name)
          if (normalized) {
            store.byName.set(normalized, projectEntry)
          }

          // Index by status (use doc.status, not directory, as source of truth)
          const statusList = store.byStatus.get(doc.status)
          if (statusList) {
            statusList.push(projectEntry)
          }

          // Add to entries list
          store.entries.push(projectEntry)
        } catch (err) {
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
   * Overview files are fully indexed; other .md files are indexed by path only.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)

    const isOverview = filePath.endsWith(path.join('_project', 'overview.md'))

    if (!isOverview) {
      const doc = Document.fromMarkdown(contents)
      this.byPath.set(filePath, doc)
      return
    }

    const doc = ProjectDocument.fromMarkdown(contents)
    this.byPath.set(filePath, doc)

    if (!doc.name) return

    const projectDir = path.dirname(path.dirname(filePath))

    const projectEntry: ProjectEntry = {
      value: doc,
      path: filePath,
      projectDir,
    }

    const normalized = normalizeName(doc.name)
    if (normalized) {
      this.byName.set(normalized, projectEntry)
    }

    const statusList = this.byStatus.get(doc.status)
    if (statusList) {
      statusList.push(projectEntry)
    }

    this.entries.push(projectEntry)
  }

  /**
   * Remove a document by file path.
   */
  delete(filePath: string): void {
    this.byPath.delete(filePath)

    // Remove from byName
    for (const [key, entry] of this.byName) {
      if (entry.path === filePath) {
        this.byName.delete(key)
      }
    }

    // Remove from byStatus
    for (const [status, list] of this.byStatus) {
      const idx = list.findIndex((e) => e.path === filePath)
      if (idx !== -1) {
        list.splice(idx, 1)
      }
    }

    // Remove from entries
    const idx = this.entries.findIndex((e) => e.path === filePath)
    if (idx !== -1) {
      this.entries.splice(idx, 1)
    }
  }

  /**
   * Find a project by name (case-insensitive).
   * Returns the entry with the document, file path, and project directory.
   */
  find(name: string): ProjectEntry | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a project by file path.
   */
  findByPath(filePath: string): Document | undefined {
    return this.byPath.get(filePath)
  }

  /**
   * Get all projects as a collection.
   */
  getAll(): Collection<ProjectDocument> {
    const docs = this.entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'project')
  }

  /**
   * Get projects by status.
   */
  getByStatus(status: ProjectStatus): Collection<ProjectDocument> {
    const entries = this.byStatus.get(status) ?? []
    const docs = entries.map((e) => ({ doc: e.value, path: e.path }))
    return Collection.from(docs, 'project')
  }

  /**
   * Get all open projects.
   */
  getOpen(): Collection<ProjectDocument> {
    return this.getByStatus('open')
  }

  /**
   * Get all on-hold projects.
   */
  getOnHold(): Collection<ProjectDocument> {
    return this.getByStatus('hold')
  }

  /**
   * Get all closed projects (completed or canceled).
   */
  getClosed(): Collection<ProjectDocument> {
    return this.getByStatus('completed').merge(this.getByStatus('canceled'))
  }

  /**
   * Get all indexed names.
   */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /**
   * Number of projects.
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
