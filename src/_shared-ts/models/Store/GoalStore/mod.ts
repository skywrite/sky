import * as path from 'node:path'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import GoalDocument from '#shared/models/Goal/mod.ts'
import type { Goal, GoalCategory } from '#shared/models/Goal/mod.ts'
import { Collection } from '#shared/models/Markdown/mod.ts'
import type { StoreError, StoreWarning } from '../types.ts'

interface GoalEntry {
  value: GoalDocument
  path: string
}

/**
 * Store for Goal documents.
 *
 * Goals are stored at:
 * - {goalsDir}/personal.md
 * - {goalsDir}/professional.md
 *
 * The store provides access by category and aggregated views.
 */
export default class GoalStore {
  private personal: GoalEntry | null = null
  private professional: GoalEntry | null = null

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
   * Build a GoalStore by loading the goals directory.
   *
   * @param goalsDir - Base goals directory (e.g., DIR_GOALS)
   */
  static async build(goalsDir: string): Promise<GoalStore> {
    const store = new GoalStore()

    if (!(await exists(goalsDir))) {
      return store
    }

    // Load personal.md
    const personalPath = path.join(goalsDir, 'personal.md')
    if (await exists(personalPath)) {
      try {
        const contents = await readTextFile(personalPath)
        const doc = GoalDocument.fromMarkdown(contents)

        if (doc.yamlError) {
          store._warnings.push({
            path: personalPath,
            warning: `YAML error: ${doc.yamlError}`,
          })
        }

        store.personal = { value: doc, path: personalPath }
      } catch (err) {
        store._errors.push({
          path: personalPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Load professional.md
    const professionalPath = path.join(goalsDir, 'professional.md')
    if (await exists(professionalPath)) {
      try {
        const contents = await readTextFile(professionalPath)
        const doc = GoalDocument.fromMarkdown(contents)

        if (doc.yamlError) {
          store._warnings.push({
            path: professionalPath,
            warning: `YAML error: ${doc.yamlError}`,
          })
        }

        store.professional = { value: doc, path: professionalPath }
      } catch (err) {
        store._errors.push({
          path: professionalPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return store
  }

  /**
   * Add or update a goal document by file path and raw contents.
   * Routes to personal or professional based on basename.
   */
  set(filePath: string, contents: string): void {
    const doc = GoalDocument.fromMarkdown(contents)
    const basename = path.basename(filePath)
    const entry: GoalEntry = { value: doc, path: filePath }

    if (basename === 'personal.md') {
      this.personal = entry
    } else if (basename === 'professional.md') {
      this.professional = entry
    }
  }

  /**
   * Remove a goal document by file path.
   */
  delete(filePath: string): void {
    if (this.personal?.path === filePath) {
      this.personal = null
    }
    if (this.professional?.path === filePath) {
      this.professional = null
    }
  }

  /**
   * Get the personal goals document.
   */
  getPersonal(): GoalDocument | undefined {
    return this.personal?.value
  }

  /**
   * Get the professional goals document.
   */
  getProfessional(): GoalDocument | undefined {
    return this.professional?.value
  }

  /**
   * Get a goals document by category.
   */
  getByCategory(category: GoalCategory): GoalDocument | undefined {
    return category === 'Personal' ? this.getPersonal() : this.getProfessional()
  }

  /**
   * Get the file path for a category.
   */
  getPath(category: GoalCategory): string | undefined {
    return category === 'Personal' ? this.personal?.path : this.professional?.path
  }

  /**
   * Get all goal documents as a collection.
   */
  getAll(): Collection<GoalDocument> {
    const docs: Array<{ doc: GoalDocument; path: string }> = []
    if (this.personal) docs.push({ doc: this.personal.value, path: this.personal.path })
    if (this.professional) docs.push({ doc: this.professional.value, path: this.professional.path })
    return Collection.from(docs, 'goal')
  }

  /**
   * Get all goals (flattened from all documents).
   */
  getAllGoals(): Goal[] {
    return this.getAll()
      .getAll()
      .flatMap((doc) => doc.goals)
  }

  /**
   * Get all goals filtered by area (across all documents).
   */
  getByArea(area: string): Goal[] {
    return this.getAllGoals().filter((g) => g.area.toLowerCase() === area.toLowerCase())
  }

  /**
   * Get all unique areas across all goals.
   */
  get areas(): string[] {
    return [...new Set(this.getAllGoals().map((g) => g.area))]
  }

  /**
   * Find a goal document by its absolute file path.
   */
  findByPath(filePath: string): GoalDocument | undefined {
    if (this.personal?.path === filePath) return this.personal.value
    if (this.professional?.path === filePath) return this.professional.value
    return undefined
  }

  /**
   * Number of goal documents loaded.
   */
  get size(): number {
    return (this.personal ? 1 : 0) + (this.professional ? 1 : 0)
  }

  /**
   * Total number of individual goals across all documents.
   */
  get goalCount(): number {
    return this.getAllGoals().length
  }

  /**
   * Check if any goals exist.
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
