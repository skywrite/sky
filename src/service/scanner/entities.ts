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
 * Action filenames carry their medium as one `_`-separated segment, in any
 * position — every generation of the naming convention is on disk:
 *   - `HH-MM_Medium_Who_Title.md`   (current: `09-45_Zoom_Jane-Doe_Sync.md`)
 *   - `Medium_Who_Title.md`         (legacy: `zoom_Jane-Doe_Sync.md`)
 *   - `Who_Medium.md`               (legacy: `Jane-Doe_In-Person.md`)
 * Matching is segment-exact, so a medium word inside a hyphenated title
 * segment (`…_Zoom-Strategy-Discussion.md`) never classifies a file.
 *
 * Weights:
 * - Meetings: 10 points (meeting, zoom, phone, in-person/inperson, call,
 *   ft-audio, google-meet; anything under /events/)
 * - Email:     5 points (email)
 * - Messages:  3 points (slack, loom, imessage, whatsapp, signal, and their
 *   -audio variants)
 * - Day files: 2 points (day.md — frontmatter rel mentions)
 *
 * Deliberately unweighted: gdoc, gslides, video, x — shared artifacts and
 * posts, not direct interactions.
 */
const MEETING_TOKENS = new Set(['meeting', 'zoom', 'phone', 'inperson', 'in-person', 'call', 'ft-audio', 'google-meet'])
const EMAIL_TOKENS = new Set(['email'])
const MESSAGE_TOKENS = new Set([
  'slack',
  'loom',
  'imessage',
  'imessage-audio',
  'whatsapp',
  'whatsapp-audio',
  'signal',
  'signal-audio',
])

export function getInteractionWeight(filePath: string): number {
  const filename = path.basename(filePath).toLowerCase()

  // Day files (rel field mentions)
  if (filename === 'day.md') {
    return INTERACTION_WEIGHTS.day
  }

  // Events folder counts as meetings regardless of filename
  if (filePath.includes('/events/')) {
    return INTERACTION_WEIGHTS.meeting
  }

  const segments = filename.replace(/\.md$/, '').split('_')
  if (segments.some((s) => MEETING_TOKENS.has(s))) {
    return INTERACTION_WEIGHTS.meeting
  }
  if (segments.some((s) => EMAIL_TOKENS.has(s))) {
    return INTERACTION_WEIGHTS.email
  }
  if (segments.some((s) => MESSAGE_TOKENS.has(s))) {
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
