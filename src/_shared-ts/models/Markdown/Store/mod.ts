import * as path from 'node:path'
import { existsSync } from 'node:fs'
import PersonDocument from '#shared/models/Person/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import GoalDocument from '#shared/models/Goal/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import IdeaDocument from '#shared/models/Idea/mod.ts'
import PlaceDocument from '#shared/models/Place/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import OrgStore from '#shared/models/Store/OrgStore/mod.ts'
import ProjectStore from '#shared/models/Store/ProjectStore/mod.ts'
import DecisionStore from '#shared/models/Store/DecisionStore/mod.ts'
import GoalStore from '#shared/models/Store/GoalStore/mod.ts'
import StreakStore from '#shared/models/Store/StreakStore/mod.ts'
import IdeaStore from '#shared/models/Store/IdeaStore/mod.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import DocumentStore from '#shared/models/Store/DocumentStore/mod.ts'
import * as config from '#config'

export type EntityType =
  | 'person'
  | 'org'
  | 'project'
  | 'decision'
  | 'goal'
  | 'streak'
  | 'idea'
  | 'place'
  | 'url'
  | 'document'

export type ResolvedRef =
  | { type: 'person'; value: PersonDocument; path: string; raw: string }
  | { type: 'org'; value: OrganizationDocument; path: string; raw: string }
  | { type: 'project'; value: ProjectDocument; path: string; raw: string }
  | { type: 'decision'; value: DecisionDocument; path: string; raw: string }
  | { type: 'goal'; value: GoalDocument; path: string; raw: string }
  | { type: 'streak'; value: StreakDocument; path: string; raw: string }
  | { type: 'idea'; value: IdeaDocument; path: string; raw: string }
  | { type: 'place'; value: PlaceDocument; path: string; raw: string }
  | { type: 'document'; value: Document; path: string; raw: string }
  | { type: 'file'; value: null; path: string; raw: string }
  | { type: 'url'; value: URL; raw: string }
  | { type: 'unresolved'; value: null; raw: string }

export type ResolveContext = {
  year?: number
  month?: number
  /** Absolute path of the source file (for resolving ./ relative refs) */
  sourceFilePath?: string
}

const URL_PATTERN = /^https?:\/\//i

export interface MarkdownStoreConfig {
  peopleDirs: string[]
  orgDirs: string[]
  projectsDir?: string
  decisionsDir?: string
  goalsDir?: string
  streaksDir?: string
  ideasDir?: string
  placesDir?: string
  timeDirs?: string[]
}

/** Unified store for markdown documents with entity resolution */
export default class MarkdownStore {
  readonly people: PeopleStore
  readonly orgs: OrgStore
  readonly projects: ProjectStore
  readonly decisions: DecisionStore
  readonly goals: GoalStore
  readonly streaks: StreakStore
  readonly ideas: IdeaStore
  readonly places: PlaceStore
  readonly time: DocumentStore

  /** Stored config for routing set/delete to correct sub-store */
  private dirs: MarkdownStoreConfig

  private constructor(
    people: PeopleStore,
    orgs: OrgStore,
    projects: ProjectStore,
    decisions: DecisionStore,
    goals: GoalStore,
    streaks: StreakStore,
    ideas: IdeaStore,
    places: PlaceStore,
    time: DocumentStore,
    dirs: MarkdownStoreConfig,
  ) {
    this.people = people
    this.orgs = orgs
    this.projects = projects
    this.decisions = decisions
    this.goals = goals
    this.streaks = streaks
    this.ideas = ideas
    this.places = places
    this.time = time
    this.dirs = dirs
  }

  static async build(cfg: MarkdownStoreConfig): Promise<MarkdownStore> {
    const [people, orgs, projects, decisions, goals, streaks, ideas, places, time] = await Promise.all([
      PeopleStore.build(cfg.peopleDirs),
      OrgStore.build(cfg.orgDirs),
      cfg.projectsDir ? ProjectStore.build(cfg.projectsDir) : Promise.resolve(ProjectStore.empty()),
      cfg.decisionsDir ? DecisionStore.build(cfg.decisionsDir) : Promise.resolve(DecisionStore.empty()),
      cfg.goalsDir ? GoalStore.build(cfg.goalsDir) : Promise.resolve(GoalStore.empty()),
      cfg.streaksDir ? StreakStore.build(cfg.streaksDir) : Promise.resolve(StreakStore.empty()),
      cfg.ideasDir ? IdeaStore.build(cfg.ideasDir) : Promise.resolve(IdeaStore.empty()),
      cfg.placesDir ? PlaceStore.build(cfg.placesDir) : Promise.resolve(PlaceStore.empty()),
      DocumentStore.build(cfg.timeDirs ?? []),
    ])

    return new MarkdownStore(people, orgs, projects, decisions, goals, streaks, ideas, places, time, cfg)
  }

  /**
   * Build a MarkdownStore with all entity directories from config.
   * Loads people, orgs, projects, decisions, goals, ideas, places, and time.
   *
   * TODO: Include global notes from config.DIR_NOTES (Notebook/notes/) for
   * relationship resolution and AI context.
   */
  static buildFromAll(): Promise<MarkdownStore> {
    return MarkdownStore.build({
      peopleDirs: [config.DIR_PEOPLE, config.DIR_PEOPLE_OLD],
      orgDirs: [config.DIR_ORGS],
      projectsDir: config.DIR_PROJECTS,
      decisionsDir: config.DIR_DECISIONS,
      goalsDir: config.DIR_GOALS,
      streaksDir: config.DIR_STREAKS,
      ideasDir: config.DIR_IDEAS,
      placesDir: config.DIR_PLACES,
      timeDirs: [config.DIR_TIME],
    })
  }

  /**
   * Monotonic mutation counter, bumped by every routed set()/delete().
   *
   * The DomainCollection the query layers serve is a derived copy of this
   * store; this counter is how their caches answer "has the store changed
   * since I built my copy?" — each cache remembers the version it was built
   * at and compares on read (see liveDc() in service/graphql/schema.ts and
   * the executeQuery cache in DomainCollection/query/execute.ts).
   *
   * Invalidation is deliberately pull-based. The push alternative (writers
   * call an explicit reset) already failed once: the watcher reset a module
   * cache the served yoga resolvers never used, so deleted files kept
   * resolving until restart. Bumping inside the only two write paths makes
   * invalidation a side effect of mutation — impossible to forget at a call
   * site. It is a counter rather than a dirty flag because several caches
   * read it independently; a flag would be cleared by whichever cache
   * rebuilt first, leaving the others stale.
   */
  private _version = 0

  get version(): number {
    return this._version
  }

  /** Sub-store responsible for a file path, or null when no configured directory contains it. */
  private routeFor(
    filePath: string,
  ): { set(filePath: string, contents: string): void; delete(filePath: string): void } | null {
    for (const dir of this.dirs.peopleDirs) {
      if (filePath.startsWith(dir)) return this.people
    }
    for (const dir of this.dirs.orgDirs) {
      if (filePath.startsWith(dir)) return this.orgs
    }
    if (this.dirs.projectsDir && filePath.startsWith(this.dirs.projectsDir)) return this.projects
    if (this.dirs.decisionsDir && filePath.startsWith(this.dirs.decisionsDir)) return this.decisions
    if (this.dirs.goalsDir && filePath.startsWith(this.dirs.goalsDir)) return this.goals
    if (this.dirs.streaksDir && filePath.startsWith(this.dirs.streaksDir)) return this.streaks
    if (this.dirs.ideasDir && filePath.startsWith(this.dirs.ideasDir)) return this.ideas
    if (this.dirs.placesDir && filePath.startsWith(this.dirs.placesDir)) return this.places
    for (const dir of this.dirs.timeDirs ?? []) {
      if (filePath.startsWith(dir)) return this.time
    }
    return null
  }

  /**
   * Add or update a document by file path and raw contents.
   * Routes to the correct sub-store based on which configured directory the path falls under.
   */
  set(filePath: string, contents: string): void {
    const target = this.routeFor(filePath)
    if (!target) return
    target.set(filePath, contents)
    this._version++
  }

  /**
   * Remove a document by file path.
   * Routes to the correct sub-store based on which configured directory the path falls under.
   */
  delete(filePath: string): void {
    const target = this.routeFor(filePath)
    if (!target) return
    target.delete(filePath)
    this._version++
  }

  /**
   * Resolution order: URL, projects/, decisions/, goals/, streaks/, ideas/, places/, person, org, time doc, unresolved
   */
  resolve(raw: string, context?: ResolveContext): ResolvedRef {
    // Guard against null/undefined/non-string values
    if (typeof raw !== 'string' || !raw) {
      return { type: 'unresolved', value: null, raw: String(raw ?? '') }
    }

    // Relative file reference: ./filename or ./path/to/file
    if (raw.startsWith('./') && context?.sourceFilePath) {
      const dir = path.dirname(context.sourceFilePath)
      const resolved = path.resolve(dir, raw)
      // Try exact path first, then with .md extension
      const candidates = [resolved, `${resolved}.md`]
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return { type: 'file', value: null, path: candidate, raw }
        }
      }
    }

    if (URL_PATTERN.test(raw)) {
      try {
        return { type: 'url', value: new URL(raw), raw }
      } catch {
        // Invalid URL, continue
      }
    }

    if (raw.startsWith('projects/')) {
      const projectName = raw.slice('projects/'.length)
      const project = this.projects.find(projectName)
      if (project) {
        return { type: 'project', value: project.value, path: project.path, raw }
      }
    }

    if (raw.startsWith('decisions/')) {
      const decisionName = raw.slice('decisions/'.length)
      const decision = this.decisions.find(decisionName)
      if (decision) {
        return { type: 'decision', value: decision.value, path: decision.path, raw }
      }
    }

    if (raw.startsWith('goals/')) {
      const goalCategory = raw.slice('goals/'.length).toLowerCase()
      if (goalCategory === 'personal' || goalCategory === 'professional') {
        const category = goalCategory === 'personal' ? 'Personal' : 'Professional'
        const goal = this.goals.getByCategory(category)
        const goalPath = this.goals.getPath(category)
        if (goal && goalPath) {
          return { type: 'goal', value: goal, path: goalPath, raw }
        }
      }
    }

    if (raw.startsWith('streaks/')) {
      const streakName = raw.slice('streaks/'.length)
      const streak = this.streaks.find(streakName)
      if (streak) {
        return { type: 'streak', value: streak.value, path: streak.path, raw }
      }
    }

    if (raw.startsWith('ideas/')) {
      const ideaName = raw.slice('ideas/'.length)
      const idea = this.ideas.find(ideaName)
      if (idea) {
        return { type: 'idea', value: idea.value, path: idea.path, raw }
      }
    }

    if (raw.startsWith('places/')) {
      const place = this.places.findByPlacePath(raw)
      if (place) {
        return { type: 'place', value: place.value, path: place.path, raw }
      }
    }

    const person = this.people.find(raw)
    if (person) {
      return { type: 'person', value: person.value, path: person.path, raw }
    }

    const org = this.orgs.find(raw)
    if (org) {
      return { type: 'org', value: org.value, path: org.path, raw }
    }

    const doc = this.time.resolveRef(raw, context ?? {})
    if (doc) {
      return { type: 'document', value: doc.value, path: doc.path, raw }
    }

    return { type: 'unresolved', value: null, raw }
  }

  resolveAll(rawStrings: Iterable<string>, context?: ResolveContext): ResolvedRef[] {
    return Array.from(rawStrings).map((raw) => this.resolve(raw, context))
  }

  canResolve(raw: string, context?: ResolveContext): boolean {
    return this.resolve(raw, context).type !== 'unresolved'
  }

  /**
   * Look up a document by its absolute file path across all sub-stores.
   */
  findByPath(filePath: string): { doc: Document; type: EntityType } | undefined {
    const person = this.people.findByPath(filePath)
    if (person) return { doc: person, type: 'person' }

    const org = this.orgs.findByPath(filePath)
    if (org) return { doc: org, type: 'org' }

    const project = this.projects.findByPath(filePath)
    if (project) return { doc: project, type: 'project' }

    const decision = this.decisions.findByPath(filePath)
    if (decision) return { doc: decision, type: 'decision' }

    const goal = this.goals.findByPath(filePath)
    if (goal) return { doc: goal, type: 'goal' }

    const idea = this.ideas.findByPath(filePath)
    if (idea) return { doc: idea, type: 'idea' }

    const place = this.places.findByPath(filePath)
    if (place) return { doc: place, type: 'place' }

    const timeDoc = this.time.findByPath(filePath)
    if (timeDoc) return { doc: timeDoc, type: 'document' }

    return undefined
  }
}
