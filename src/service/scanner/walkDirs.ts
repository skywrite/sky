/**
 * Shared directory walking and scanning logic.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import type { Store } from '../store.ts'
import type { EntityDetector } from './entities.ts'

/**
 * Scanner functions returned by createScanners.
 */
export interface Scanners {
  readFileAndUpdateTags(contents: string, filePath?: string): void
  readFileAndUpdatePeople(contents: string, file: string): void
  readFileAndUpdateOrganizations(contents: string, file: string): void
  trackPersonInteractions(contents: string, filePath: string): void
  trackOrgInteractionsFromProject(contents: string): void
}

/**
 * Options for scanDirectories.
 */
export interface ScanOptions {
  /** Directories to scan */
  dirs: string[]
  /** Store instance to update */
  store: Store
  /** Entity detector for path-based type checks */
  entityDetector: EntityDetector
  /** Scanner functions */
  scanners: Scanners
}

/**
 * Walk directories and feed every markdown file through the scanners,
 * updating the store. No logging or score events — callers own those.
 */
export async function scanFiles(options: ScanOptions): Promise<void> {
  const { dirs, entityDetector, scanners } = options
  const { isPerson, isOrganization, isProject, isTimeFile } = entityDetector
  const {
    readFileAndUpdateTags,
    readFileAndUpdatePeople,
    readFileAndUpdateOrganizations,
    trackPersonInteractions,
    trackOrgInteractionsFromProject,
  } = scanners

  for (const dir of dirs) {
    for await (const entry of walk(dir)) {
      if (path.extname(entry.path) !== '.md') continue

      try {
        const contents = await readTextFile(entry.path)
        readFileAndUpdateTags(contents, entry.path)

        if (isPerson(entry.path)) {
          readFileAndUpdatePeople(contents, entry.path)
        }

        if (isOrganization(entry.path)) {
          readFileAndUpdateOrganizations(contents, entry.path)
        }

        if (isTimeFile(entry.path)) {
          trackPersonInteractions(contents, entry.path)
        }

        if (isProject(entry.path)) {
          trackOrgInteractionsFromProject(contents)
        }
      } catch (err) {
        console.error(`FILE: ${entry.path}`)
        console.error(err)
      }
    }
  }
}

/**
 * Walk directories and process all markdown files.
 *
 * This is the main scanning loop used during server startup.
 * It processes all .md files and updates the store with:
 * - Tags from all files
 * - People from person files
 * - Organizations from org files
 * - Interactions from time files
 * - Org interactions from project files
 */
export async function scanDirectories(options: ScanOptions): Promise<void> {
  const { store } = options

  await scanFiles(options)

  // Emit scores after scan completes
  console.log(`[personScores] Initial scan complete. Tracked ${store.personScores.size} people with scores.`)
  store.emitPersonScoresUpdated()

  console.log(`[orgScores] Initial scan complete. Tracked ${store.orgScores.size} organizations with scores.`)
  store.emitOrgScoresUpdated()

  console.log(`[tagScores] Initial scan complete. Tracked ${store.scoring.tagScores.size} tags with scores.`)
  store.emitTagScoresUpdated()
}

/**
 * Process a single file update (used by file watchers).
 *
 * Returns whether any scores were updated (for callers who need to emit events).
 */
export function processFileUpdate(
  contents: string,
  filePath: string,
  entityDetector: EntityDetector,
  scanners: Scanners,
): { personScoresUpdated: boolean; orgScoresUpdated: boolean; tagScoresUpdated: boolean } {
  const { isPerson, isOrganization, isProject, isTimeFile } = entityDetector
  const {
    readFileAndUpdateTags,
    readFileAndUpdatePeople,
    readFileAndUpdateOrganizations,
    trackPersonInteractions,
    trackOrgInteractionsFromProject,
  } = scanners

  let personScoresUpdated = false
  let orgScoresUpdated = false

  readFileAndUpdateTags(contents, filePath)

  if (isPerson(filePath)) {
    readFileAndUpdatePeople(contents, filePath)
    personScoresUpdated = true
    orgScoresUpdated = true
  }

  if (isOrganization(filePath)) {
    readFileAndUpdateOrganizations(contents, filePath)
    orgScoresUpdated = true
  }

  if (isTimeFile(filePath)) {
    trackPersonInteractions(contents, filePath)
    personScoresUpdated = true
    orgScoresUpdated = true
  }

  if (isProject(filePath)) {
    trackOrgInteractionsFromProject(contents)
    orgScoresUpdated = true
  }

  return { personScoresUpdated, orgScoresUpdated, tagScoresUpdated: true }
}
