import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'
import { PatternMatcher } from './_recurring/mod.ts'

// Legacy tokens for backward compatibility
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const WEEKEND = ['Saturday', 'Sunday']
const LEGACY_TOKENS = ['EVERY DAY', 'WEEKDAYS', 'WEEKEND', ...WEEKDAYS, ...WEEKEND]

/**
 * Check if a token looks like a new pattern (contains hyphen)
 */
function isNewPattern(token: string): boolean {
  // New patterns use hyphens: EVERY-DAY, MONTHLY-15, etc.
  return token.includes('-')
}

/**
 * Match using legacy logic
 */
function matchLegacy(tokenText: string, dateScanString: string): boolean {
  if (!LEGACY_TOKENS.includes(tokenText)) {
    // Don't warn for new patterns
    if (!isNewPattern(tokenText)) {
      console.log(`\n  WARN: ${tokenText} is not a valid token to match against.\n`)
    }
    return false
  }

  switch (tokenText) {
    case 'EVERY DAY':
      return true
    case 'WEEKDAYS':
      return WEEKDAYS.includes(dateScanString)
    case 'WEEKEND':
      return WEEKEND.includes(dateScanString)
    default:
      return tokenText === dateScanString
  }
}

/**
 * Match using new pattern system
 */
function matchPattern(pattern: string, date: PlainDate): boolean {
  try {
    const matcher = new PatternMatcher(pattern)
    return matcher.matches(date)
  } catch {
    // If pattern is invalid, return false
    return false
  }
}

/**
 * Extract day items from a document for a given date
 * Supports both legacy format (weekday names) and new pattern format
 *
 * @param doc - The document containing recurring items
 * @param date - The date to extract items for
 */
export default function extractDayItems(doc: ListDocument, date: PlainDate): string[] {
  // Get the weekday name for legacy matching
  const dateScanString = date.dayLong // "Monday", "Tuesday", etc.

  const matchedLists = doc.lists.filter((list) => {
    const tokenText = list.title

    // Check if this is a new pattern format
    if (isNewPattern(tokenText)) {
      return matchPattern(tokenText, date)
    }

    // Fall back to legacy matching
    return matchLegacy(tokenText, dateScanString)
  })

  // no matches
  if (matchedLists.length === 0) return []

  const dayItems: string[] = []

  matchedLists.forEach((list) => {
    dayItems.push(...list.items)
  })

  return dayItems
}
