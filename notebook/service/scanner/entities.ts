/**
 * Entity detection helpers for determining file types based on paths.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import * as path from 'node:path'
import { INTERACTION_WEIGHTS } from '../store.ts'

/**
 * Path configuration for entity detection.
 */
export interface PathConfig {
  people: string
  peopleOld: string
  orgs: string
  projects: string
  places: string
  time: string
}

/**
 * Entity detector bound to specific paths.
 */
export interface EntityDetector {
  isPerson(filePath: string): boolean
  isOrganization(filePath: string): boolean
  isProject(filePath: string): boolean
  isPlace(filePath: string): boolean
  isTimeFile(filePath: string): boolean
}

/**
 * Create an entity detector bound to specific paths.
 */
export function createEntityDetector(paths: PathConfig): EntityDetector {
  return {
    isPerson(filePath: string): boolean {
      return filePath.includes(paths.people) || filePath.includes(paths.peopleOld)
    },

    isOrganization(filePath: string): boolean {
      return filePath.includes(paths.orgs)
    },

    isProject(filePath: string): boolean {
      return filePath.includes(paths.projects)
    },

    isPlace(filePath: string): boolean {
      return filePath.includes(paths.places)
    },

    isTimeFile(filePath: string): boolean {
      return filePath.includes(paths.time)
    },
  }
}

/**
 * Get interaction weight based on file type.
 *
 * Higher weights for more direct/meaningful interactions.
 * Score formula: weight × recencyMultiplier (see store.calculateRecencyMultiplier)
 *
 * Weights:
 * - Meeting files: 10 points (zoom_, phone_, meeting_, inperson_, call_, ft-audio_, google-meet_)
 * - Email files:    5 points (email_)
 * - Slack/Loom:     3 points (slack_, loom_)
 * - Day mentions:   2 points (day.md rel field)
 */
export function getInteractionWeight(filePath: string): number {
  const filename = path.basename(filePath).toLowerCase()

  // Meeting file patterns (including events folder)
  if (
    filename.startsWith('meeting_') ||
    filename.startsWith('zoom_') ||
    filename.startsWith('phone_') ||
    filename.startsWith('inperson_') ||
    filename.startsWith('in-person_') ||
    filename.startsWith('call_') ||
    filename.startsWith('ft-audio_') ||
    filename.startsWith('google-meet_') ||
    filePath.includes('/events/')
  ) {
    return INTERACTION_WEIGHTS.meeting
  }

  // Email files
  if (filename.startsWith('email_')) {
    return INTERACTION_WEIGHTS.email
  }

  // Day files (rel field mentions)
  if (filename === 'day.md') {
    return INTERACTION_WEIGHTS.day
  }

  // Slack/Loom/other communication
  if (filename.startsWith('slack_') || filename.startsWith('loom_')) {
    return INTERACTION_WEIGHTS.slack
  }

  return 0
}

/**
 * Parse people/entities from a comma/semicolon separated string or array.
 * Filters out tags, project references, and other non-person values.
 */
export function parsePeopleFromField(value: unknown): string[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string')
  }

  if (typeof value === 'string') {
    // Split by comma or semicolon and clean up
    return value
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith('#') && !p.startsWith('projects/') && !p.startsWith('acme/'))
  }

  return []
}
