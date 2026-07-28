import {
  Collection,
  type CollectionEntityType,
  type CollectionItem,
  type Document,
  type MarkdownOutputOptions,
} from '#shared/models/Markdown/mod.ts'
import { detectTypeFromPath } from '#shared/models/Markdown/Collection/entityTypes.ts'
import type PersonDocument from '#shared/models/Person/mod.ts'
import type OrganizationDocument from '#shared/models/Organization/mod.ts'
import type ProjectDocument from '#shared/models/Project/mod.ts'
import type GoalDocument from '#shared/models/Goal/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import type IdeaDocument from '#shared/models/Idea/mod.ts'
import type PlaceDocument from '#shared/models/Place/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { ResolvedRef } from '#shared/models/Store/mod.ts'
import { parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import { executeQuery } from './query/execute.ts'
import { selectorToGraphQL } from './query/transpiler.ts'
import { parseSelector } from './query/parser.ts'

/** Options for building a collection */
export type CollectionOptions = {
  /** Maximum depth for relationship traversal (default: Infinity) */
  depth?: number
  /** Whether to include the root document(s) in output (default: true) */
  includeRoot?: boolean
}

/** Options for markdown output - re-export from Collection */
export type MarkdownOptions = MarkdownOutputOptions

/**
 * A collection of related documents for AI consumption.
 *
 * Built on top of MarkdownCollection, adds relationship traversal via MarkdownStore.
 * Collects documents from entry points, traverses relationships, deduplicates,
 * and outputs structured markdown.
 *
 * Output order: orgs → people → projects → goals → messages → meetings → journals → day → documents
 *
 * TODO: Consider making DomainCollection immutable like MarkdownCollection.
 * Currently it mutates `this.collection` via addDocument()/addFromRef(),
 * which is an awkward mix — immutable inner collection, mutable outer wrapper.
 */
export default class DomainCollection {
  private collection: Collection<Document>
  private store: MarkdownStore | null

  private constructor(store: MarkdownStore | null = null) {
    this.collection = Collection.empty()
    this.store = store
  }

  /**
   * Create a collection from a single document, traversing its relationships.
   */
  static fromDocument(
    doc: Document,
    path: string,
    store: MarkdownStore,
    opts: CollectionOptions = {},
  ): DomainCollection {
    const domain = new DomainCollection(store)
    const { depth = Infinity, includeRoot = true } = opts

    if (includeRoot) {
      domain.addDocument(doc, path, 0)
    }

    domain.traverseRelationships(doc, path, depth, 1)

    return domain
  }

  /**
   * Create a collection from multiple documents.
   */
  static fromDocuments(
    docs: Array<{ doc: Document; path: string }>,
    store: MarkdownStore | null,
    opts: CollectionOptions = {},
  ): DomainCollection {
    const domain = new DomainCollection(store)
    const { depth = Infinity, includeRoot = true } = opts

    for (const { doc, path } of docs) {
      if (includeRoot) {
        domain.addDocument(doc, path, 0)
      }

      domain.traverseRelationships(doc, path, depth, 1)
    }

    return domain
  }

  /**
   * Create a collection from resolved refs (e.g., from RelSet).
   */
  static fromRefs(refs: ResolvedRef[], store: MarkdownStore, opts: CollectionOptions = {}): DomainCollection {
    const domain = new DomainCollection(store)
    const { depth = Infinity } = opts

    for (const ref of refs) {
      if (
        ref.type === 'person' ||
        ref.type === 'org' ||
        ref.type === 'project' ||
        ref.type === 'goal' ||
        ref.type === 'idea' ||
        ref.type === 'place' ||
        ref.type === 'document'
      ) {
        domain.addFromRef(ref, 0)

        domain.traverseRelationships(ref.value, ref.path ?? '', depth, 1)
      }
    }

    return domain
  }

  /**
   * Create a collection containing ALL documents from the store.
   *
   * This is the foundation for query/filter operations - load everything
   * once, then filter in memory.
   */
  static fromStore(store: MarkdownStore): DomainCollection {
    // Build a plain Map directly to avoid O(n²) from immutable Collection.add().
    // Each add() copies the entire Map; with 20k docs that's ~200M entries copied.
    // Instead, build the Map mutably here, then wrap once via Collection.fromMap().
    const items = new Map<string, CollectionItem<Document>>()

    function addAll(collection: { toArray(): Array<{ doc: Document; path: string }> }) {
      for (const { doc, path } of collection.toArray()) {
        const type = detectTypeFromPath(path)
        items.set(path, { doc, path, type, depth: 0 })
      }
    }

    addAll(store.people.getAll())
    addAll(store.orgs.getAll())
    addAll(store.projects.getAll())
    addAll(store.projects.getDocuments())
    addAll(store.decisions.getAll())
    addAll(store.goals.getAll())
    addAll(store.streaks.getAll())
    addAll(store.ideas.getAll())
    addAll(store.places.getAll())
    addAll(store.time.getAll())

    const domain = new DomainCollection(store)
    domain.collection = Collection.fromMap(items)
    return domain
  }

  /**
   * Merge with another DomainCollection.
   * Duplicate paths are kept from this collection (not overwritten).
   */
  merge(other: DomainCollection): DomainCollection {
    const merged = new DomainCollection(this.store ?? other.store)
    merged.collection = this.collection.merge(other.collection)
    return merged
  }

  /** Number of documents in the collection */
  get size(): number {
    return this.collection.size
  }

  /** All organization documents */
  get orgs(): OrganizationDocument[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'org').getAll() as OrganizationDocument[]
  }

  /** All person documents */
  get people(): PersonDocument[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'person').getAll() as PersonDocument[]
  }

  /** All project documents */
  get projects(): ProjectDocument[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'project').getAll() as ProjectDocument[]
  }

  /** All goal documents */
  get goals(): GoalDocument[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'goal').getAll() as GoalDocument[]
  }

  /**
   * All streak documents.
   *
   * Constructed rather than cast (like videos): fromStore holds real
   * StreakDocuments, but fromDocuments-built collections (ai:context) parse
   * everything as plain Document, so the cast would lie there.
   */
  get streaks(): StreakDocument[] {
    return this.collection
      .filter((_, path) => detectTypeFromPath(path) === 'streak')
      .getAll()
      .map((doc) => (doc instanceof StreakDocument ? doc : new StreakDocument(doc.yaml, doc.markdown, doc.yamlError)))
  }

  /** All idea documents */
  get ideas(): IdeaDocument[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'idea').getAll() as IdeaDocument[]
  }

  /** All place documents */
  get places(): PlaceDocument[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'place').getAll() as PlaceDocument[]
  }

  /**
   * All video documents.
   *
   * Constructed rather than cast: the scanner parses every time-based file into a
   * plain Document, so there is no VideoDocument to narrow to. The entity getters
   * above (orgs, people, …) read from typed sub-stores and can cast safely.
   */
  get videos(): VideoDocument[] {
    return this.collection
      .filter((_, path) => detectTypeFromPath(path) === 'video')
      .getAll()
      .map((doc) => new VideoDocument(doc.yaml, doc.markdown, doc.yamlError))
  }

  /** All other documents (not org, person, project, goal, or place) */
  get documents(): Document[] {
    return this.collection.filter((_, path) => detectTypeFromPath(path) === 'document').getAll()
  }

  /** All file paths in the collection */
  get paths(): string[] {
    return this.collection.paths
  }

  /** Get all entries (doc + path pairs) for a specific entity type */
  entriesByType(type: CollectionEntityType | '*'): Array<{ doc: Document; path: string }> {
    if (type === '*') {
      return this.collection.toArray()
    }
    return this.collection.filter((_, path) => detectTypeFromPath(path) === type).toArray()
  }

  /** All items with full metadata (doc, path, type, depth) */
  get allItems(): CollectionItem<Document>[] {
    return this.collection.getAllItems()
  }

  /** Check if a path is already in the collection */
  has(path: string): boolean {
    return this.collection.has(path)
  }

  /**
   * Output the collection as structured markdown for AI consumption.
   * Delegates to MarkdownCollection.toMarkdown() for consistent ordering.
   */
  toMarkdown(opts: MarkdownOptions = {}): string {
    return this.collection.toMarkdown(opts)
  }

  /**
   * Query documents using CSS-like selector syntax.
   * Transpiles to GraphQL and executes via the GraphQL resolvers.
   *
   * @example
   * await domain.query('meeting:recent(7d)')
   * await domain.query('person[org="MoonPay"]')
   * await domain.query('decision:pending')
   */
  async query(selector: string): Promise<{ count: number; paths: string[] }> {
    if (!this.store) {
      throw new Error('Cannot query a DomainCollection without a store')
    }

    const { query } = selectorToGraphQL(selector)
    const result = await executeQuery<Record<string, Array<{ path: string }>>>(query, this.store)

    const paths: string[] = []
    if (result.data) {
      for (const entries of Object.values(result.data)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry.path) paths.push(entry.path)
          }
        }
      }
    }

    return { count: paths.length, paths }
  }

  /**
   * Validate a selector string without executing it.
   */
  validateSelector(selector: string): { valid: boolean; error?: string } {
    try {
      parseSelector(selector)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // --- Private methods ---

  private addDocument(doc: Document, path: string, depth = 0): void {
    this.collection = this.collection.add(doc, path, undefined, depth)
  }

  private addFromRef(ref: ResolvedRef, depth = 0): void {
    if (ref.type === 'unresolved' || ref.type === 'url' || ref.type === 'file') return

    // Map ref type to collection entity type
    const typeMap: Record<string, CollectionEntityType> = {
      person: 'person',
      org: 'org',
      project: 'project',
      goal: 'goal',
      idea: 'idea',
      decision: 'decision',
      place: 'place',
      document: 'document',
    }
    const type = typeMap[ref.type] ?? 'document'

    this.collection = this.collection.add(ref.value, ref.path, type, depth)
  }

  private traverseRelationships(doc: Document, path: string, remainingDepth: number, currentDepth: number): void {
    if (!this.store) return

    // Always follow previous chains regardless of depth.
    // The doc being traversed is at (currentDepth - 1); its previous chain shares that depth.
    this.traversePreviousChain(doc, path, currentDepth - 1)

    if (remainingDepth <= 0) return

    // Get all relationship fields from the document
    const relStrings = this.extractRelStrings(doc)

    // Resolve each and add to collection
    const resolved = this.store.resolveAll(relStrings)

    for (const ref of resolved) {
      if (ref.type === 'unresolved' || ref.type === 'url' || ref.type === 'file') continue

      const alreadyExists = this.collection.has(ref.path)
      this.addFromRef(ref, currentDepth)

      // Only recurse into new paths (avoid infinite loops)
      if (!alreadyExists && remainingDepth > 1) {
        this.traverseRelationships(ref.value, ref.path!, remainingDepth - 1, currentDepth + 1)
      }
    }
  }

  /**
   * Follow `previous` YAML links to pull in full message chains.
   * Only follows `previous` — no `rel` fan-out from chained documents.
   */
  private traversePreviousChain(doc: Document, docPath: string, currentDepth: number): void {
    if (!this.store) return
    const prev = doc.yaml['previous']
    if (typeof prev !== 'string') return

    // Derive year/month context from the current doc's path
    let context: { year?: number; month?: number } = {}
    try {
      const date = parseDateFromDayPath(docPath)
      context = { year: date.year, month: date.month }
    } catch {
      /* non-time path, skip */
    }

    const ref = this.store.resolve(prev, context)
    if (ref.type === 'unresolved' || ref.type === 'url' || ref.type === 'file') return
    if (!ref.path) return

    const alreadyExists = this.collection.has(ref.path)
    this.addFromRef(ref, currentDepth)

    // Keep following the chain (only previous, not rel)
    if (!alreadyExists) {
      this.traversePreviousChain(ref.value, ref.path, currentDepth)
    }
  }

  private extractRelStrings(doc: Document): string[] {
    const strings: string[] = []
    const yaml = doc.yaml

    // rel: field (ImmutableSet<string>)
    if (doc.rel) {
      for (const r of doc.rel) {
        strings.push(r)
      }
    }

    // who: field (meetings, events) - can be array or comma-separated string
    const who = yaml['who']
    if (Array.isArray(who)) {
      strings.push(...who)
    } else if (typeof who === 'string') {
      // Split comma-separated names
      strings.push(...who.split(',').map((s) => s.trim()))
    }

    // from: field (messages)
    const from = yaml['from']
    if (typeof from === 'string') {
      strings.push(from)
    }

    // to: field (messages)
    const to = yaml['to']
    if (Array.isArray(to)) {
      strings.push(...to)
    } else if (typeof to === 'string') {
      strings.push(to)
    }

    // org: field (people)
    const org = yaml['org']
    if (typeof org === 'string') {
      strings.push(org)
    }

    // Scan body for decisions/, projects/, and ideas/ inline references
    // Pattern: HH:MM > decisions/Name -> ... or HH:MM > projects/Name -> ... or HH:MM > ideas/Name -> ...
    const bodyPattern = /\d{2}:\d{2} > ((?:decisions|projects|ideas)\/[^\s]+) ->/g
    let match
    while ((match = bodyPattern.exec(doc.markdown)) !== null) {
      strings.push(match[1])
    }

    return strings
  }
}
