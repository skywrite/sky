/**
 * ScoringStore - Tracks interaction scores for people and organizations.
 *
 * Decoupled from the main Store to allow independent use with any data source.
 *
 * Scoring formula: score += weight × recencyMultiplier
 * - weight: determined by interaction type (meeting=10, email=5, slack=3, day=2)
 * - recencyMultiplier: decays over time (1.0 → 0.05)
 *
 * Scores are cumulative - frequent interactions compound.
 */

import { EventEmitter } from 'node:events'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Interaction weights by type.
 * Higher weights indicate stronger relationship signals.
 */
export const INTERACTION_WEIGHTS = {
  meeting: 10, // Direct meetings (zoom, phone, in-person)
  project: 10, // Working on shared project
  email: 5, // Email correspondence
  personMet: 5, // Person's "met" date with org field
  slack: 3, // Slack/Loom messages
  day: 2, // Day file mentions
} as const

/**
 * Recency multipliers for scoring decay.
 * Recent interactions are weighted higher to surface active relationships.
 */
export const RECENCY_MULTIPLIERS = {
  week: 1.0, // 0-7 days: full weight
  month: 0.5, // 8-30 days: half weight
  quarter: 0.25, // 31-90 days: quarter weight
  year: 0.1, // 91-365 days: 10% weight
  older: 0.05, // >365 days: 5% weight
} as const

/**
 * Recency thresholds in days.
 */
export const RECENCY_THRESHOLDS = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
} as const

export interface PersonScore {
  name: string
  score: number
  lastInteraction: string | null // ISO date
  interactionCount: number
}

export interface OrgScore {
  name: string
  score: number
  lastInteraction: string | null // ISO date
  interactionCount: number
}

export interface TagScore {
  name: string
  score: number
  lastSeen: string | null // ISO date
  fileCount: number
}

export interface ScoringStoreEvents {
  personScoresUpdated: [PersonScore[]]
  orgScoresUpdated: [OrgScore[]]
  tagScoresUpdated: [TagScore[]]
}

/**
 * Standalone scoring store for people and organization interactions.
 *
 * Usage:
 * ```typescript
 * const scoring = new ScoringStore()
 *
 * // Record interactions
 * scoring.recordPersonInteraction('Alice', '2026-01-15', INTERACTION_WEIGHTS.meeting)
 * scoring.recordOrgInteraction('Acme Inc', '2026-01-15', INTERACTION_WEIGHTS.project)
 *
 * // Get sorted scores
 * const topPeople = scoring.getPeopleWithScores(allPeopleNames)
 * const topOrgs = scoring.getOrgsWithScores(allOrgNames)
 * ```
 */
/** One file's share of a score — what forgetting the file takes back. */
interface Contribution {
  kind: 'person' | 'org' | 'tag'
  name: string
  dateStr: string
  points: number
}

/** The entries of one person as one: scores and counts added, the latest interaction kept. */
function asOnePerson(name: string, entries: Iterable<PersonScore>): PersonScore {
  const one: PersonScore = { name, score: 0, lastInteraction: null, interactionCount: 0 }
  for (const entry of entries) {
    one.score += entry.score
    one.interactionCount += entry.interactionCount
    if (entry.lastInteraction && (!one.lastInteraction || entry.lastInteraction > one.lastInteraction)) {
      one.lastInteraction = entry.lastInteraction
    }
  }
  return one
}

export class ScoringStore extends EventEmitter {
  private _personScores = new Map<string, PersonScore>()
  private _orgScores = new Map<string, OrgScore>()
  private _tagScores = new Map<string, TagScore>()
  /** What each source — a file — contributed, so it can be taken back before the file is read again */
  private _bySource = new Map<string, Contribution[]>()

  get personScores(): Map<string, PersonScore> {
    return this._personScores
  }

  get orgScores(): Map<string, OrgScore> {
    return this._orgScores
  }

  get tagScores(): Map<string, TagScore> {
    return this._tagScores
  }

  /**
   * Replace all score state with another store's, preserving this instance's
   * identity so existing event-forwarding subscriptions stay wired. Used by
   * entity-store rebuilds after file removals.
   */
  replaceFrom(other: ScoringStore): void {
    this._personScores = new Map(other._personScores)
    this._orgScores = new Map(other._orgScores)
    this._tagScores = new Map(other._tagScores)
    this._bySource = new Map([...other._bySource].map(([source, list]) => [source, [...list]]))
  }

  /**
   * Record an interaction with a person.
   *
   * @param name - Person's name
   * @param dateStr - ISO date string (YYYY-MM-DD)
   * @param weight - Interaction weight (use INTERACTION_WEIGHTS constants)
   * @param referenceDate - Reference date for recency calculation (defaults to today)
   * @param source - The file this was read from, so `forgetSource` can take it back
   */
  recordPersonInteraction(
    name: string,
    dateStr: string,
    weight: number,
    referenceDate?: PlainDate,
    source?: string,
  ): void {
    const existing = this._personScores.get(name)
    const recencyMultiplier = this.calculateRecencyMultiplier(dateStr, referenceDate)
    const points = weight * recencyMultiplier

    if (existing) {
      existing.score += points
      existing.interactionCount += 1
      // Update lastInteraction if this is more recent
      if (!existing.lastInteraction || dateStr > existing.lastInteraction) {
        existing.lastInteraction = dateStr
      }
    } else {
      this._personScores.set(name, {
        name,
        score: points,
        lastInteraction: dateStr,
        interactionCount: 1,
      })
    }
    if (source) this.contribute(source, { kind: 'person', name, dateStr, points })
  }

  /**
   * Record an interaction with an organization.
   *
   * @param name - Organization name
   * @param dateStr - ISO date string (YYYY-MM-DD)
   * @param weight - Interaction weight (use INTERACTION_WEIGHTS constants)
   * @param referenceDate - Reference date for recency calculation (defaults to today)
   * @param source - The file this was read from, so `forgetSource` can take it back
   */
  recordOrgInteraction(
    name: string,
    dateStr: string,
    weight: number,
    referenceDate?: PlainDate,
    source?: string,
  ): void {
    const existing = this._orgScores.get(name)
    const recencyMultiplier = this.calculateRecencyMultiplier(dateStr, referenceDate)
    const points = weight * recencyMultiplier

    if (existing) {
      existing.score += points
      existing.interactionCount += 1
      // Update lastInteraction if this is more recent
      if (!existing.lastInteraction || dateStr > existing.lastInteraction) {
        existing.lastInteraction = dateStr
      }
    } else {
      this._orgScores.set(name, {
        name,
        score: points,
        lastInteraction: dateStr,
        interactionCount: 1,
      })
    }
    if (source) this.contribute(source, { kind: 'org', name, dateStr, points })
  }

  /**
   * Record a tag usage from a file.
   *
   * @param name - Tag name
   * @param dateStr - ISO date string (YYYY-MM-DD) of the file containing the tag
   * @param referenceDate - Reference date for recency calculation (defaults to today)
   * @param source - The file this was read from, so `forgetSource` can take it back
   */
  recordTagInteraction(name: string, dateStr: string, referenceDate?: PlainDate, source?: string): void {
    const existing = this._tagScores.get(name)
    const recencyMultiplier = this.calculateRecencyMultiplier(dateStr, referenceDate)
    const points = recencyMultiplier // weight = 1 per file occurrence

    if (existing) {
      existing.score += points
      existing.fileCount += 1
      if (!existing.lastSeen || dateStr > existing.lastSeen) {
        existing.lastSeen = dateStr
      }
    } else {
      this._tagScores.set(name, {
        name,
        score: points,
        lastSeen: dateStr,
        fileCount: 1,
      })
    }
    if (source) this.contribute(source, { kind: 'tag', name, dateStr, points })
  }

  private contribute(source: string, contribution: Contribution): void {
    const list = this._bySource.get(source) ?? []
    list.push(contribution)
    this._bySource.set(source, list)
  }

  /**
   * Take back everything a source — a file — contributed, so the file can be
   * read again without counting twice. Scores and counts come down by the
   * file's share, a last date is found again among what remains, and an
   * entry with nothing left goes. Returns whether the source had contributed.
   */
  forgetSource(source: string): boolean {
    const contributions = this._bySource.get(source)
    if (!contributions) return false
    this._bySource.delete(source)

    const affected = new Map<string, Contribution['kind']>()
    for (const { kind, name, points } of contributions) {
      affected.set(`${kind}\n${name}`, kind)
      if (kind === 'tag') {
        const entry = this._tagScores.get(name)
        if (entry) {
          entry.score -= points
          entry.fileCount -= 1
        }
      } else {
        const entry = (kind === 'person' ? this._personScores : this._orgScores).get(name)
        if (entry) {
          entry.score -= points
          entry.interactionCount -= 1
        }
      }
    }

    const latest = new Map<string, string>()
    for (const list of this._bySource.values()) {
      for (const { kind, name, dateStr } of list) {
        const key = `${kind}\n${name}`
        if (!affected.has(key)) continue
        const known = latest.get(key)
        if (!known || dateStr > known) latest.set(key, dateStr)
      }
    }

    for (const [key, kind] of affected) {
      const name = key.slice(kind.length + 1)
      if (kind === 'tag') {
        const entry = this._tagScores.get(name)
        if (!entry) continue
        if (entry.fileCount <= 0) this._tagScores.delete(name)
        else entry.lastSeen = latest.get(key) ?? entry.lastSeen
      } else {
        const map = kind === 'person' ? this._personScores : this._orgScores
        const entry = map.get(name)
        if (!entry) continue
        if (entry.interactionCount <= 0) map.delete(name)
        else entry.lastInteraction = latest.get(key) ?? entry.lastInteraction
      }
    }
    return true
  }

  /**
   * Calculate recency multiplier based on days since interaction.
   *
   * Recent interactions are weighted higher to surface people you're
   * actively working with over historical contacts.
   *
   * @param dateStr - ISO date string (YYYY-MM-DD)
   * @param referenceDate - Reference date for calculating recency (defaults to today)
   */
  calculateRecencyMultiplier(dateStr: string, referenceDate: PlainDate = PlainDate.today()): number {
    const interactionDate = new PlainDate(dateStr)
    const msPerDay = 1000 * 60 * 60 * 24
    const daysSince = Math.floor((referenceDate.toDate().getTime() - interactionDate.toDate().getTime()) / msPerDay)

    if (daysSince <= RECENCY_THRESHOLDS.week) return RECENCY_MULTIPLIERS.week
    if (daysSince <= RECENCY_THRESHOLDS.month) return RECENCY_MULTIPLIERS.month
    if (daysSince <= RECENCY_THRESHOLDS.quarter) return RECENCY_MULTIPLIERS.quarter
    if (daysSince <= RECENCY_THRESHOLDS.year) return RECENCY_MULTIPLIERS.year
    return RECENCY_MULTIPLIERS.older
  }

  /**
   * Get people sorted by score (descending).
   *
   * @param allPeople - All known people names (includes those without scores)
   * @param spellingsOf - The other names a person goes by; absent = the name alone
   * @returns Sorted array with all people, zero-scored ones included
   */
  getPeopleWithScores(allPeople: Iterable<string>, spellingsOf?: (name: string) => Iterable<string>): PersonScore[] {
    // A person is one person however a file spelled them: entries whose
    // names match case-insensitively add up, and so do the entries for the
    // other spellings `spellingsOf` gives — a profile's `name:` list. Two
    // reported names that are the same name report once.
    const byNormalized = new Map<string, PersonScore[]>()
    for (const entry of this._personScores.values()) {
      const key = normalizeName(entry.name)
      const entries = byNormalized.get(key) ?? []
      entries.push(entry)
      byNormalized.set(key, entries)
    }

    const result: PersonScore[] = []
    const reported = new Set<string>()
    for (const name of allPeople) {
      const key = normalizeName(name)
      if (reported.has(key)) continue
      reported.add(key)
      const spellings = new Set([key])
      for (const spelling of spellingsOf?.(name) ?? []) spellings.add(normalizeName(spelling))
      const entries = new Set<PersonScore>()
      for (const spelling of spellings) for (const entry of byNormalized.get(spelling) ?? []) entries.add(entry)
      result.push(asOnePerson(name, entries))
    }

    // Sort by score descending, then by name ascending for ties
    return result.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Get organizations sorted by score (descending).
   *
   * @param allOrgs - All known organization names (includes those without scores)
   * @returns Sorted array with all orgs, zero-scored ones included
   */
  getOrgsWithScores(allOrgs: Iterable<string>): OrgScore[] {
    const result: OrgScore[] = []

    for (const name of allOrgs) {
      const existing = this._orgScores.get(name)
      if (existing) {
        result.push(existing)
      } else {
        result.push({ name, score: 0, lastInteraction: null, interactionCount: 0 })
      }
    }

    // Sort by score descending, then by name ascending for ties
    return result.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Emit person scores updated event.
   */
  emitPersonScoresUpdated(allPeople: Iterable<string>, spellingsOf?: (name: string) => Iterable<string>): void {
    this.emit('personScoresUpdated', this.getPeopleWithScores(allPeople, spellingsOf))
  }

  /**
   * Emit org scores updated event.
   */
  emitOrgScoresUpdated(allOrgs: Iterable<string>): void {
    this.emit('orgScoresUpdated', this.getOrgsWithScores(allOrgs))
  }

  /**
   * Get tags sorted by score (descending).
   *
   * @param allTags - All known tag names (includes those without scores)
   * @returns Sorted array with all tags, zero-scored ones included
   */
  getTagsWithScores(allTags: Iterable<string>): TagScore[] {
    const result: TagScore[] = []

    for (const name of allTags) {
      const existing = this._tagScores.get(name)
      if (existing) {
        result.push(existing)
      } else {
        result.push({ name, score: 0, lastSeen: null, fileCount: 0 })
      }
    }

    return result.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Emit tag scores updated event.
   */
  emitTagScoresUpdated(allTags: Iterable<string>): void {
    this.emit('tagScoresUpdated', this.getTagsWithScores(allTags))
  }

  /**
   * Clear all scores (useful for testing or re-scanning).
   */
  clear(): void {
    this._personScores.clear()
    this._orgScores.clear()
    this._tagScores.clear()
  }
}
