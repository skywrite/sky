/**
 * Recurring pattern matching system for tasks
 * Now uses PlainDate for cleaner date handling
 *
 * @module
 */

export { matchesPattern, PatternMatcher } from './PatternMatcher.ts'

// Re-export pattern definitions from shared module
export {
  type DeprecatedPattern,
  type DynamicPattern,
  getAllPatternNames,
  isValidPattern,
  patterns,
  type RecurringPattern,
} from '#shared/universal/dates/recurring/patterns.ts'
