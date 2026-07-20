/**
 * Shared file scanning functions for extracting tags, people, orgs, and interactions.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import MarkdownDoc from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { INTERACTION_WEIGHTS, type Store } from '../store.ts'
import { getInteractionWeight, parsePeopleFromField } from './entities.ts'
import { parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import { REGEX_YMD_EXACT } from '#universal/dates/regex/mod.ts'

/**
 * Entity type checker functions.
 */
export interface EntityChecker {
  isTimeFile(filePath: string): boolean
}

/**
 * Options for creating scanners.
 */
export interface ScannerOptions {
  /**
   * Reference date for recency calculations.
   * Pass a fixed date for deterministic testing.
   * Defaults to today in production.
   */
  referenceDate?: PlainDate
}

/**
 * Create file scanning functions bound to a specific store instance.
 *
 * @param options.referenceDate - Fixed date for recency calculations (for testing)
 */
export function createScanners(store: Store, entityChecker: EntityChecker, options: ScannerOptions = {}) {
  const { referenceDate } = options
  /**
   * Extract tags from a file and update the store.
   * Records tag interactions with recency scoring when a date can be determined.
   */
  function readFileAndUpdateTags(contents: string, filePath?: string): void {
    const md = MarkdownDoc.fromMarkdown(contents)
    if (md.tags.size === 0) return

    // Exclude project references — handled by dedicated project completions
    const filteredTags = TagSet.fromArray(Array.from(md.tags).filter((tag) => !tag.startsWith('projects/')))
    if (filteredTags.size === 0) return

    const newSet = store.tags.union(filteredTags)
    store.update('tags', newSet)

    // Record tag interactions for scoring
    let dateStr: string | undefined

    // Try to extract date from file path (works for day/time files)
    if (filePath) {
      try {
        dateStr = parseDateFromDayPath(filePath).ymd
      } catch {
        // Not a date-structured path
      }
    }

    // Fall back to frontmatter date or created fields
    if (!dateStr) {
      const fmDate = md.yaml.date ?? md.yaml.created
      if (typeof fmDate === 'string' && REGEX_YMD_EXACT.test(fmDate)) {
        dateStr = fmDate
      }
    }

    if (!dateStr) return

    for (const tag of filteredTags) {
      store.recordTagInteraction(tag, dateStr, referenceDate)
    }
  }

  /**
   * Extract people from a person file and update the store.
   * Also records the 'met' date as an interaction.
   */
  function readFileAndUpdatePeople(contents: string, file: string): void {
    const md = MarkdownDoc.fromMarkdown(contents)
    const person = md.yaml.name || md.yaml.who

    let persons: string[] = []

    if (Array.isArray(person)) persons = [...person]
    else if (typeof person === 'string') persons = [person]
    else {
      console.warn(`[scan] person file missing name/who: ${file}`)
    }

    const newSet = store.people.union(new Set(persons))
    store.update('people', newSet)

    // Record 'met' date as an interaction so new contacts appear in recent list
    const metDate = md.yaml.met
    if (typeof metDate === 'string' && REGEX_YMD_EXACT.test(metDate) && persons.length > 0) {
      for (const name of persons) {
        store.recordInteraction(name, metDate, INTERACTION_WEIGHTS.personMet, referenceDate)
      }

      // Also track org interaction if person has an org
      const personOrg = md.yaml.org ?? (md.yaml.orgs as Record<string, unknown>)?.current
      if (typeof personOrg === 'string' && personOrg.trim()) {
        store.recordOrgInteraction(personOrg.trim(), metDate, INTERACTION_WEIGHTS.personMet, referenceDate)
      }
    }
  }

  /**
   * Extract organizations from an org file and update the store.
   */
  function readFileAndUpdateOrganizations(contents: string, file: string): void {
    const md = MarkdownDoc.fromMarkdown(contents)
    const orgName = md.yaml.name

    let orgs: string[] = []

    if (Array.isArray(orgName)) orgs = [...orgName]
    else if (typeof orgName === 'string') orgs = [orgName]
    else {
      console.warn(`[scan] org file missing name: ${file}`)
    }

    const newSet = store.organizations.union(new Set(orgs))
    store.update('organizations', newSet)
  }

  /**
   * Track person and org interactions from a time file (meetings, emails, etc.).
   */
  function trackPersonInteractions(contents: string, filePath: string): void {
    if (!entityChecker.isTimeFile(filePath)) return

    const weight = getInteractionWeight(filePath)
    if (weight === 0) return

    // Extract date from the file path
    let dateStr: string
    try {
      dateStr = parseDateFromDayPath(filePath).ymd
    } catch {
      // Can't extract date, skip tracking
      return
    }

    const md = MarkdownDoc.fromMarkdown(contents)

    // Extract people from various fields
    const whoPeople = parsePeopleFromField(md.yaml.who)
    const relPeople = parsePeopleFromField(md.yaml.rel)
    const toPeople = parsePeopleFromField(md.yaml.to)
    const fromPeople = parsePeopleFromField(md.yaml.from)
    const ccPeople = parsePeopleFromField(md.yaml.cc)
    const bccPeople = parsePeopleFromField(md.yaml.bcc)

    // Combine all people and record interactions
    const allPeople = new Set([...whoPeople, ...relPeople, ...toPeople, ...fromPeople, ...ccPeople, ...bccPeople])

    for (const person of allPeople) {
      // Skip if it looks like a project reference
      if (person.includes('/')) continue

      // Check if this is an org reference - if so, track org interaction
      if (store.organizations.has(person)) {
        store.recordOrgInteraction(person, dateStr, weight, referenceDate)
      } else {
        store.recordInteraction(person, dateStr, weight, referenceDate)
      }
    }
  }

  /**
   * Track org interactions from a project file.
   * Projects often reference orgs in their `rel` field.
   */
  function trackOrgInteractionsFromProject(contents: string): void {
    const md = MarkdownDoc.fromMarkdown(contents)

    // Use project created date, or fall back to today
    const created = md.yaml.created
    const dateStr =
      typeof created === 'string' && REGEX_YMD_EXACT.test(created) ? created : new Date().toISOString().slice(0, 10)

    // Extract orgs from 'rel' field
    const relValue = md.yaml.rel
    const relItems = parsePeopleFromField(relValue)

    for (const item of relItems) {
      if (item.includes('/')) continue

      // Only track if it's a known org
      if (store.organizations.has(item)) {
        store.recordOrgInteraction(item, dateStr, INTERACTION_WEIGHTS.project, referenceDate)
      }
    }
  }

  return {
    readFileAndUpdateTags,
    readFileAndUpdatePeople,
    readFileAndUpdateOrganizations,
    trackPersonInteractions,
    trackOrgInteractionsFromProject,
  }
}
