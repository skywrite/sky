/**
 * TODO: Eliminate this legacy Store entirely.
 *
 * MarkdownStore already has all the same documents parsed in its 8 sub-stores.
 * This Store duplicates people/org/tag name sets and wraps ScoringStore.
 *
 * Plan:
 *
 * 1. Add cached computed properties to MarkdownStore:
 *    - `peopleNames: string[]` — original-case names from person documents
 *    - `orgNames: string[]` — original-case names from org documents
 *    - `tags: string[]` — all tags from all documents' YAML frontmatter
 *    Each is cached, invalidated on set()/delete().
 *
 * 2. ScoringStore absorbs all events:
 *    ScoringStore already extends EventEmitter and emits score events.
 *    Add list-change events: `peopleUpdated`, `organizationsUpdated`, `tagsUpdated`.
 *    Service layer emits these after MarkdownStore mutations in watchFiles().
 *
 * 3. Update consumers:
 *    - GraphQL resolvers: store.people → markdownStore.peopleNames
 *    - GraphQL resolvers: store.organizations → markdownStore.orgNames
 *    - GraphQL resolvers: store.tags → markdownStore.tags
 *    - GraphQL resolvers: store.getPeopleWithScores() → scoringStore.getPeopleWithScores(...)
 *    - WebSocket handlers: subscribe to scoringStore instead of store
 *    - Scanners: stop calling store.update('people', ...) — MarkdownStore handles via set()
 *    - Scanners: keep calling scoringStore.recordInteraction(...) for scoring
 *
 * 4. Delete this file (service/store.ts).
 */
import { EventEmitter } from 'node:events'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import {
  INTERACTION_WEIGHTS,
  type OrgScore,
  type PersonScore,
  RECENCY_MULTIPLIERS,
  RECENCY_THRESHOLDS,
  ScoringStore,
  type TagScore,
} from './scoring/mod.ts'

// Re-export scoring types and constants for backwards compatibility
export { INTERACTION_WEIGHTS, type OrgScore, type PersonScore, RECENCY_MULTIPLIERS, RECENCY_THRESHOLDS, type TagScore }

type Keys = 'people' | 'tags' | 'organizations'

/**
 * Main store for the notebook service.
 *
 * Tracks:
 * - People names (Set<string>)
 * - Organization names (Set<string>)
 * - Tags (TagSet)
 * - Interaction scores (delegated to ScoringStore)
 */
export class Store extends EventEmitter {
  private _people = new Set<string>()
  private _tags = TagSet.EMPTY
  private _organizations = new Set<string>()
  private _scoring = new ScoringStore()

  constructor() {
    super()

    // Forward scoring events
    this._scoring.on('personScoresUpdated', (scores) => {
      this.emit('personScoresUpdated', scores)
    })
    this._scoring.on('orgScoresUpdated', (scores) => {
      this.emit('orgScoresUpdated', scores)
    })
    this._scoring.on('tagScoresUpdated', (scores) => {
      this.emit('tagScoresUpdated', scores)
    })
  }

  get people(): Set<string> {
    return this._people
  }

  get tags(): TagSet {
    return this._tags
  }

  get organizations(): Set<string> {
    return this._organizations
  }

  /**
   * Access the underlying scoring store directly.
   */
  get scoring(): ScoringStore {
    return this._scoring
  }

  /**
   * @deprecated Use `scoring.personScores` instead
   */
  get personScores(): Map<string, PersonScore> {
    return this._scoring.personScores
  }

  /**
   * @deprecated Use `scoring.orgScores` instead
   */
  get orgScores(): Map<string, OrgScore> {
    return this._scoring.orgScores
  }

  /**
   * Get people sorted by score (descending)
   */
  getPeopleWithScores(): PersonScore[] {
    return this._scoring.getPeopleWithScores(this._people)
  }

  /**
   * Record an interaction with a person.
   *
   * Scoring formula: score += weight × recencyMultiplier
   * - weight: determined by interaction type (meeting=10, email=5, slack=3, day=2)
   * - recencyMultiplier: decays over time (1.0 → 0.05)
   *
   * Scores are cumulative - frequent interactions compound.
   *
   * @param today - Reference date for recency calculation (defaults to today, pass fixed date for testing)
   */
  recordInteraction(name: string, dateStr: string, weight: number, today?: PlainDate): void {
    this._scoring.recordPersonInteraction(name, dateStr, weight, today)
  }

  /**
   * Calculate recency multiplier based on days since interaction.
   *
   * @deprecated Use `scoring.calculateRecencyMultiplier` instead
   */
  calculateRecencyMultiplier(dateStr: string, today: PlainDate = PlainDate.today()): number {
    return this._scoring.calculateRecencyMultiplier(dateStr, today)
  }

  /**
   * Emit person scores updated event
   */
  emitPersonScoresUpdated(): void {
    this._scoring.emitPersonScoresUpdated(this._people)
  }

  /**
   * Get organizations sorted by score (descending)
   */
  getOrganizationsWithScores(): OrgScore[] {
    return this._scoring.getOrgsWithScores(this._organizations)
  }

  /**
   * Record an interaction with an organization.
   *
   * Scoring formula: score += weight × recencyMultiplier
   * - weight: determined by interaction type (meeting=10, email=5, slack=3, day=2)
   * - recencyMultiplier: decays over time (1.0 → 0.05)
   *
   * Scores are cumulative - frequent interactions compound.
   *
   * @param today - Reference date for recency calculation (defaults to today, pass fixed date for testing)
   */
  recordOrgInteraction(name: string, dateStr: string, weight: number, today?: PlainDate): void {
    this._scoring.recordOrgInteraction(name, dateStr, weight, today)
  }

  /**
   * Emit org scores updated event
   */
  emitOrgScoresUpdated(): void {
    this._scoring.emitOrgScoresUpdated(this._organizations)
  }

  /**
   * Record a tag usage from a file.
   *
   * @param today - Reference date for recency calculation (defaults to today, pass fixed date for testing)
   */
  recordTagInteraction(name: string, dateStr: string, today?: PlainDate): void {
    this._scoring.recordTagInteraction(name, dateStr, today)
  }

  /**
   * Get tags sorted by score (descending)
   */
  getTagsWithScores(): TagScore[] {
    return this._scoring.getTagsWithScores(this._tags)
  }

  /**
   * Emit tag scores updated event
   */
  emitTagScoresUpdated(): void {
    this._scoring.emitTagScoresUpdated(this._tags)
  }

  update<K extends Keys>(key: K, value: unknown) {
    ;(this as any)['_' + key] = value
    this.emit(`${key}Updated`, value)
  }
}

export default new Store()
