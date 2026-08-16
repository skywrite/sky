/**
 * Test fixtures for service testing.
 *
 * Provides mock data directories with:
 * - 10 organizations (7 Mag 7 + 3 made-up)
 * - 12 people across various orgs
 * - 10 interactions (meetings, emails, slack) across multiple dates
 * - 3 projects
 *
 * Use these fixtures for deterministic scoring tests.
 * Always use FIXTURE_REFERENCE_DATE when creating a Store for tests.
 */

import dirnameFilename from '#lib/util/dirnameFilename.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { PathConfig } from '../server.ts'

const { __dirname } = dirnameFilename(import.meta.url)

/** Base directory for all fixtures (without trailing slash) */
export const FIXTURES_DIR = __dirname.replace(/\/$/, '')

/** Path configuration for fixtures */
export const FIXTURE_PATHS: PathConfig = {
  people: `${FIXTURES_DIR}/people`,
  peopleOld: `${FIXTURES_DIR}/people-old`, // Empty but needed for interface
  orgs: `${FIXTURES_DIR}/orgs`,
  projects: `${FIXTURES_DIR}/projects`,
  places: `${FIXTURES_DIR}/places`, // Empty but needed for interface
  time: `${FIXTURES_DIR}/time`,
}

/** Markdown directories to scan */
export const FIXTURE_MARKDOWN_DIRS = [FIXTURES_DIR]

/**
 * Reference date for deterministic scoring tests.
 * All fixture interactions are relative to this date (2026-01-27).
 * Use this when creating a Store for fixture-based tests.
 */
export const FIXTURE_REFERENCE_DATE = new PlainDate(2026, 1, 27)

/**
 * Expected people in fixtures (alphabetical).
 */
export const EXPECTED_PEOPLE = [
  'Alex Rivera',
  'Casey Arden',
  'Chen Wei',
  'Devon Price',
  'Jennifer Walsh',
  'Kai Hansen',
  'Lisa Chen',
  'Marcus Johnson',
  'Maria Santos',
  'Michael Thompson',
  'Priya Sharma',
  'Sarah Mitchell',
]

/**
 * Expected organizations in fixtures (alphabetical).
 */
export const EXPECTED_ORGS = [
  'Acme Corp',
  'Amazon',
  'Apple',
  'Google',
  'Meta',
  'Microsoft',
  'Northwind Ventures',
  'Nvidia',
  'Quantum Labs',
  'Tesla',
]

/**
 * People with expected high interaction scores (most recent/frequent).
 * Based on fixtures data relative to FIXTURE_REFERENCE_DATE (2026-01-27):
 *
 * Chen Wei: 3 interactions (meeting 1/20, slack 1/27, met date 2023)
 * Lisa Chen: 1 meeting on 1/27
 * Kai Hansen: 1 meeting on 1/27
 */
export const HIGH_SCORE_PEOPLE = ['Chen Wei', 'Lisa Chen', 'Kai Hansen']

/**
 * Organizations with expected high interaction scores.
 * Based on fixtures:
 *
 * Acme Corp: Multiple interactions (Chen Wei, Maria Santos, Sarah Mitchell)
 * Google: Lisa Chen meeting today
 * Nvidia: Kai Hansen meeting today
 */
export const HIGH_SCORE_ORGS = ['Acme Corp', 'Google', 'Nvidia']
