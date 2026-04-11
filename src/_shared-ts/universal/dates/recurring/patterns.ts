/**
 * Recurring pattern definitions shared between Deno and Node.js environments.
 * Used by PatternMatcher, VSCode completions, and syntax highlighting.
 */

export interface RecurringPattern {
  pattern: string
  description: string
}

export interface DynamicPattern {
  regex: string
  description: string
}

export interface DeprecatedPattern {
  pattern: string
  replacement: string
}

/** Static recurring patterns with descriptions */
export const patterns: RecurringPattern[] = [
  { pattern: 'EVERY-DAY', description: 'Every day' },
  { pattern: 'EVERY-WEEKDAY', description: 'Monday through Friday' },
  { pattern: 'EVERY-WEEKEND', description: 'Saturday and Sunday' },
  { pattern: 'EVERY-MON', description: 'Every Monday' },
  { pattern: 'EVERY-TUE', description: 'Every Tuesday' },
  { pattern: 'EVERY-WED', description: 'Every Wednesday' },
  { pattern: 'EVERY-THU', description: 'Every Thursday' },
  { pattern: 'EVERY-FRI', description: 'Every Friday' },
  { pattern: 'EVERY-SAT', description: 'Every Saturday' },
  { pattern: 'EVERY-SUN', description: 'Every Sunday' },

  { pattern: 'EVERY-OTHER-DAY-A', description: 'Every other day (Day A, epoch: Jan 1, 2024)' },
  { pattern: 'EVERY-OTHER-DAY-B', description: 'Every other day (Day B, opposite of A)' },

  { pattern: 'EVERY-2-WEEKS-A-MON', description: 'Every other Monday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-MON', description: 'Every other Monday (Week B)' },
  { pattern: 'EVERY-2-WEEKS-A-TUE', description: 'Every other Tuesday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-TUE', description: 'Every other Tuesday (Week B)' },
  { pattern: 'EVERY-2-WEEKS-A-WED', description: 'Every other Wednesday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-WED', description: 'Every other Wednesday (Week B)' },
  { pattern: 'EVERY-2-WEEKS-A-THU', description: 'Every other Thursday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-THU', description: 'Every other Thursday (Week B)' },
  { pattern: 'EVERY-2-WEEKS-A-FRI', description: 'Every other Friday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-FRI', description: 'Every other Friday (Week B)' },
  { pattern: 'EVERY-2-WEEKS-A-SAT', description: 'Every other Saturday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-SAT', description: 'Every other Saturday (Week B)' },
  { pattern: 'EVERY-2-WEEKS-A-SUN', description: 'Every other Sunday (Week A)' },
  { pattern: 'EVERY-2-WEEKS-B-SUN', description: 'Every other Sunday (Week B)' },

  { pattern: 'MONTHLY-FIRST-MON', description: 'First Monday of each month' },
  { pattern: 'MONTHLY-FIRST-TUE', description: 'First Tuesday of each month' },
  { pattern: 'MONTHLY-FIRST-WED', description: 'First Wednesday of each month' },
  { pattern: 'MONTHLY-FIRST-THU', description: 'First Thursday of each month' },
  { pattern: 'MONTHLY-FIRST-FRI', description: 'First Friday of each month' },
  { pattern: 'MONTHLY-FIRST-SAT', description: 'First Saturday of each month' },
  { pattern: 'MONTHLY-FIRST-SUN', description: 'First Sunday of each month' },
  { pattern: 'MONTHLY-SECOND-MON', description: 'Second Monday of each month' },
  { pattern: 'MONTHLY-SECOND-TUE', description: 'Second Tuesday of each month' },
  { pattern: 'MONTHLY-SECOND-WED', description: 'Second Wednesday of each month' },
  { pattern: 'MONTHLY-SECOND-THU', description: 'Second Thursday of each month' },
  { pattern: 'MONTHLY-SECOND-FRI', description: 'Second Friday of each month' },
  { pattern: 'MONTHLY-SECOND-SAT', description: 'Second Saturday of each month' },
  { pattern: 'MONTHLY-SECOND-SUN', description: 'Second Sunday of each month' },
  { pattern: 'MONTHLY-THIRD-MON', description: 'Third Monday of each month' },
  { pattern: 'MONTHLY-THIRD-TUE', description: 'Third Tuesday of each month' },
  { pattern: 'MONTHLY-THIRD-WED', description: 'Third Wednesday of each month' },
  { pattern: 'MONTHLY-THIRD-THU', description: 'Third Thursday of each month' },
  { pattern: 'MONTHLY-THIRD-FRI', description: 'Third Friday of each month' },
  { pattern: 'MONTHLY-THIRD-SAT', description: 'Third Saturday of each month' },
  { pattern: 'MONTHLY-THIRD-SUN', description: 'Third Sunday of each month' },
  { pattern: 'MONTHLY-FOURTH-MON', description: 'Fourth Monday of each month' },
  { pattern: 'MONTHLY-FOURTH-TUE', description: 'Fourth Tuesday of each month' },
  { pattern: 'MONTHLY-FOURTH-WED', description: 'Fourth Wednesday of each month' },
  { pattern: 'MONTHLY-FOURTH-THU', description: 'Fourth Thursday of each month' },
  { pattern: 'MONTHLY-FOURTH-FRI', description: 'Fourth Friday of each month' },
  { pattern: 'MONTHLY-FOURTH-SAT', description: 'Fourth Saturday of each month' },
  { pattern: 'MONTHLY-FOURTH-SUN', description: 'Fourth Sunday of each month' },
  { pattern: 'MONTHLY-LAST-MON', description: 'Last Monday of each month' },
  { pattern: 'MONTHLY-LAST-TUE', description: 'Last Tuesday of each month' },
  { pattern: 'MONTHLY-LAST-WED', description: 'Last Wednesday of each month' },
  { pattern: 'MONTHLY-LAST-THU', description: 'Last Thursday of each month' },
  { pattern: 'MONTHLY-LAST-FRI', description: 'Last Friday of each month' },
  { pattern: 'MONTHLY-LAST-SAT', description: 'Last Saturday of each month' },
  { pattern: 'MONTHLY-LAST-SUN', description: 'Last Sunday of each month' },
  { pattern: 'MONTHLY-LAST-WEEKEND', description: 'Last weekend of each month' },

  { pattern: 'MONTHLY-1', description: '1st of each month' },
  { pattern: 'MONTHLY-15', description: '15th of each month' },
  { pattern: 'MONTHLY-LAST', description: 'Last day of each month' },
  { pattern: 'MONTHLY-LAST-1', description: 'Second to last day of each month' },
  { pattern: 'MONTHLY-LAST-2', description: 'Third to last day of each month' },

  { pattern: 'QUARTERLY-FIRST-MON', description: 'First Monday of each quarter' },
  { pattern: 'QUARTERLY-FIRST-TUE', description: 'First Tuesday of each quarter' },
  { pattern: 'QUARTERLY-FIRST-WED', description: 'First Wednesday of each quarter' },
  { pattern: 'QUARTERLY-FIRST-THU', description: 'First Thursday of each quarter' },
  { pattern: 'QUARTERLY-FIRST-FRI', description: 'First Friday of each quarter' },
  { pattern: 'QUARTERLY-LAST-MON', description: 'Last Monday of each quarter' },
  { pattern: 'QUARTERLY-LAST-TUE', description: 'Last Tuesday of each quarter' },
  { pattern: 'QUARTERLY-LAST-WED', description: 'Last Wednesday of each quarter' },
  { pattern: 'QUARTERLY-LAST-THU', description: 'Last Thursday of each quarter' },
  { pattern: 'QUARTERLY-LAST-FRI', description: 'Last Friday of each quarter' },
  { pattern: 'QUARTERLY-1', description: 'First day of each quarter' },
  { pattern: 'QUARTERLY-15', description: '15th day of each quarter' },
  { pattern: 'QUARTERLY-LAST', description: 'Last day of each quarter' },
  { pattern: 'QUARTERLY-LAST-1', description: 'Second to last day of each quarter' },

  // QUARTERLY-MONTH-BEFORE patterns: Match dates in the month BEFORE each quarter starts
  // Q1 (Jan) → December, Q2 (Apr) → March, Q3 (Jul) → June, Q4 (Oct) → September
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-MON', description: 'First Monday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-TUE', description: 'First Tuesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-WED', description: 'First Wednesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-THU', description: 'First Thursday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-FRI', description: 'First Friday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-SAT', description: 'First Saturday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FIRST-SUN', description: 'First Sunday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-MON', description: 'Second Monday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-TUE', description: 'Second Tuesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-WED', description: 'Second Wednesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-THU', description: 'Second Thursday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-FRI', description: 'Second Friday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-SAT', description: 'Second Saturday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-SECOND-SUN', description: 'Second Sunday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-MON', description: 'Third Monday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-TUE', description: 'Third Tuesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-WED', description: 'Third Wednesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-THU', description: 'Third Thursday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-FRI', description: 'Third Friday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-SAT', description: 'Third Saturday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-THIRD-SUN', description: 'Third Sunday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-MON', description: 'Fourth Monday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-TUE', description: 'Fourth Tuesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-WED', description: 'Fourth Wednesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-THU', description: 'Fourth Thursday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-FRI', description: 'Fourth Friday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-SAT', description: 'Fourth Saturday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-FOURTH-SUN', description: 'Fourth Sunday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-MON', description: 'Last Monday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-TUE', description: 'Last Tuesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-WED', description: 'Last Wednesday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-THU', description: 'Last Thursday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-FRI', description: 'Last Friday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-SAT', description: 'Last Saturday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST-SUN', description: 'Last Sunday of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-1', description: 'First day of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-15', description: '15th day of the month before each quarter' },
  { pattern: 'QUARTERLY-MONTH-BEFORE-LAST', description: 'Last day of the month before each quarter' },
]

/** Dynamic patterns that accept numeric values */
export const dynamicPatterns: DynamicPattern[] = [
  { regex: '^MONTHLY-\\d{1,2}$', description: 'Nth day of each month (1-31)' },
  { regex: '^MONTHLY-LAST-\\d+$', description: 'N days before month end' },
  { regex: '^QUARTERLY-\\d{1,2}$', description: 'Nth day of each quarter' },
  { regex: '^QUARTERLY-LAST-\\d+$', description: 'N days before quarter end' },
  { regex: '^QUARTERLY-MONTH-BEFORE-\\d{1,2}$', description: 'Nth day of the month before each quarter' },
]

/** Deprecated patterns with their replacements */
export const deprecated: DeprecatedPattern[] = [
  { pattern: 'ALTERNATE-MON', replacement: 'EVERY-2-WEEKS-A-MON' },
  { pattern: 'ALTERNATE-TUE', replacement: 'EVERY-2-WEEKS-A-TUE' },
  { pattern: 'ALTERNATE-WED', replacement: 'EVERY-2-WEEKS-A-WED' },
  { pattern: 'ALTERNATE-THU', replacement: 'EVERY-2-WEEKS-A-THU' },
  { pattern: 'ALTERNATE-FRI', replacement: 'EVERY-2-WEEKS-A-FRI' },
  { pattern: 'ALTERNATE-SAT', replacement: 'EVERY-2-WEEKS-A-SAT' },
  { pattern: 'ALTERNATE-SUN', replacement: 'EVERY-2-WEEKS-A-SUN' },
]

/** Set of all static pattern names for quick lookup */
const staticPatternSet = new Set(patterns.map((p) => p.pattern))

/** Set of deprecated pattern names (uppercased for case-insensitive matching) */
const deprecatedPatternSet = new Set(deprecated.map((p) => p.pattern.toUpperCase()))

/** Compiled regex patterns for dynamic matching */
const dynamicRegexes = dynamicPatterns.map((p) => new RegExp(p.regex))

/**
 * Check if a pattern string is valid (static, dynamic, or deprecated)
 */
export function isValidPattern(pattern: string): boolean {
  const normalized = pattern.toUpperCase()

  // Check static patterns
  if (staticPatternSet.has(normalized)) return true

  // Check deprecated patterns
  if (deprecatedPatternSet.has(normalized)) return true

  // Check dynamic patterns
  return dynamicRegexes.some((regex) => regex.test(normalized))
}

/**
 * Get all pattern names (static + deprecated) for completions
 */
export function getAllPatternNames(): string[] {
  return [...patterns.map((p) => p.pattern), ...deprecated.map((p) => p.pattern)]
}
