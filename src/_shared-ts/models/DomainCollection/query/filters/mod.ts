/**
 * Filter predicates for DomainCollection query.
 *
 * These functions test whether a document matches various criteria.
 * They are the core filtering logic, independent of GraphQL or selectors.
 */

// Duration parsing
export { parseDuration } from './duration.ts'

// Date filters
export {
  getDateFromPath,
  getDocumentDate,
  matchesCreatedRecently,
  matchesDate,
  matchesDateRange,
  matchesRecent,
  matchesRecentActivity,
  matchesUpdatedRecently,
} from './date.ts'

// Tag filters
export { matchesTagContains, matchesTagContainsAll, matchesTagContainsAny, matchesTagPrefix } from './tags.ts'

// Involvement filters
export { matchesInvolves, type NameResolver } from './involves.ts'
export { matchesInvolvesAll } from './involvesAll.ts'
export { matchesInvolvesAny } from './involvesAny.ts'

// Decision filters
export { matchesDecided, matchesPending } from './decision.ts'

// Generic field filters
export { matchesContains, matchesExact, matchesNull, matchesPrefix, matchesSubstring, matchesSuffix } from './field.ts'

// Body/content filters
export { matchesBodyContains, matchesBodyMatches } from './body.ts'

// Rel (relationship) filters
export { matchesRelContains, matchesRelPrefix } from './rel.ts'
