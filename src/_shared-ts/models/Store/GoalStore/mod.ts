import * as path from 'node:path'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import GoalDocument, { goalNameFromPath, goalStatusFromPath, isOneGoalFile } from '#shared/models/Goal/mod.ts'
import type { Goal, GoalCategory } from '#shared/models/Goal/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import { normalizeName } from '../normalize.ts'
import type { StoreError, StoreWarning } from '../types.ts'

interface GoalEntry {
  value: GoalDocument
  path: string
}

/**
 * Store for goal documents, one goal per file, found by name.
 *
 * Goals are stored at: {goalsDir}/active/{name}.md while pursued, then
 * {goalsDir}/archived/{year}/{name}.md once reached or dropped. Status and
 * name are derived from the file path (see Goal/paths.ts).
 *
 * Older notebooks hold whole-category files directly under {goalsDir}
 * (personal.md, professional.md). They load as active goals too, so a notebook
 * that never split its goals keeps working.
 */
export default class GoalStore {
  /** Normalized name → GoalEntry */
  private byName: Map<string, GoalEntry> = new Map()

  /** File path → GoalDocument */
  private byPath: Map<string, GoalDocument> = new Map()

  /** All entries for iteration */
  private entries: GoalEntry[] = []

  /** Errors encountered during build */
  private _errors: StoreError[] = []

  /** Warnings for files that parsed but have issues */
  private _warnings: StoreWarning[] = []

  private constructor() {}

  /**
   * Create an empty GoalStore.
   */
  static empty(): GoalStore {
    return new GoalStore()
  }

  /**
   * Build a GoalStore by walking the goals directory.
   *
   * @param goalsDir - Base goals directory (e.g., DIR_GOALS)
   */
  static async build(goalsDir: string): Promise<GoalStore> {
    const store = new GoalStore()

    if (!(await exists(goalsDir))) {
      return store
    }

    for await (const entry of walk(goalsDir, { exts: ['.md'], includeDirs: false })) {
      if (entry.name.startsWith('.')) continue

      try {
        const contents = await readTextFile(entry.path)
        const doc = GoalDocument.fromMarkdown(contents)

        if (doc.yamlError) {
          store._warnings.push({
            path: entry.path,
            warning: `YAML error: ${doc.yamlError}`,
          })
        }

        store.add(entry.path, doc)
      } catch (err) {
        store._errors.push({
          path: entry.path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Walk order follows the filesystem; a stable order keeps every reader's output the same from run to run.
    store.entries.sort((a, b) => a.path.localeCompare(b.path))

    return store
  }

  private add(filePath: string, doc: GoalDocument): void {
    const entry: GoalEntry = { value: doc, path: filePath }
    this.byPath.set(filePath, doc)
    this.byName.set(normalizeName(goalNameFromPath(filePath)), entry)
    this.entries.push(entry)
  }

  /**
   * Add or update a goal document by file path and raw contents.
   */
  set(filePath: string, contents: string): void {
    this.delete(filePath)
    this.add(filePath, GoalDocument.fromMarkdown(contents))
  }

  /**
   * Remove a goal document by file path.
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
   * Find a goal by name (case-insensitive): the file name without `.md`.
   */
  find(name: string): GoalEntry | undefined {
    return this.byName.get(normalizeName(name))
  }

  /**
   * Find a goal document by its absolute file path.
   */
  findByPath(filePath: string): GoalDocument | undefined {
    return this.byPath.get(filePath)
  }

  /** An older notebook's whole-category file, when it has one. */
  private categoryFile(category: GoalCategory): GoalEntry | undefined {
    const name = `${category.toLowerCase()}.md`
    return this.entries.find((e) => !isOneGoalFile(e.path) && path.basename(e.path) === name)
  }

  /**
   * Get the personal goals document of an older notebook.
   */
  getPersonal(): GoalDocument | undefined {
    return this.categoryFile('Personal')?.value
  }

  /**
   * Get the professional goals document of an older notebook.
   */
  getProfessional(): GoalDocument | undefined {
    return this.categoryFile('Professional')?.value
  }

  /**
   * Get an older notebook's goals document by category.
   */
  getByCategory(category: GoalCategory): GoalDocument | undefined {
    return this.categoryFile(category)?.value
  }

  /**
   * Get the file path of an older notebook's goals document for a category.
   */
  getPath(category: GoalCategory): string | undefined {
    return this.categoryFile(category)?.path
  }

  private collect(entries: GoalEntry[]): Collection<GoalDocument> {
    return Collection.from(
      entries.map((e) => ({ doc: e.value, path: e.path })),
      'goal',
    )
  }

  /**
   * Get all goal documents as a collection.
   */
  getAll(): Collection<GoalDocument> {
    return this.collect(this.entries)
  }

  /** Get the goals being pursued. */
  getActive(): Collection<GoalDocument> {
    return this.collect(this.entries.filter((e) => goalStatusFromPath(e.path) === 'active'))
  }

  /** Get the goals that were reached or dropped. */
  getArchived(): Collection<GoalDocument> {
    return this.collect(this.entries.filter((e) => goalStatusFromPath(e.path) === 'archived'))
  }

  /**
   * One line per active goal: a one-goal file gives its title, an older
   * whole-category file gives each area written inside it.
   */
  activeGoalLines(): string[] {
    return this.entries
      .filter((e) => goalStatusFromPath(e.path) === 'active')
      .flatMap((e) => (isOneGoalFile(e.path) ? [e.value.title] : e.value.goals.map((g) => `${g.area}: ${g.outcome}`)))
  }

  /**
   * Get the areas written inside older whole-category files (flattened).
   */
  getAllGoals(): Goal[] {
    return this.entries.flatMap((e) => e.value.goals)
  }

  /**
   * Get those areas filtered by name (across all documents).
   */
  getByArea(area: string): Goal[] {
    return this.getAllGoals().filter((g) => g.area.toLowerCase() === area.toLowerCase())
  }

  /**
   * Get all unique areas across older whole-category files.
   */
  get areas(): string[] {
    return [...new Set(this.getAllGoals().map((g) => g.area))]
  }

  /** Get all indexed names. */
  get names(): string[] {
    return Array.from(this.byName.keys())
  }

  /**
   * Number of goal documents loaded.
   */
  get size(): number {
    return this.entries.length
  }

  /**
   * Total number of areas written inside older whole-category files.
   */
  get goalCount(): number {
    return this.getAllGoals().length
  }

  /**
   * Check if any older whole-category file has areas written in it.
   */
  get hasGoals(): boolean {
    return this.goalCount > 0
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
