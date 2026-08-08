/**
 * Pre-built standard params for common task patterns.
 *
 * Naming convention:
 * - `*Arg` - Positional argument
 * - `*Flag` - Named flag (--name / -n)
 *
 * @example
 * ```typescript
 * import { dayNoFutureArg, dayNoFutureFlag, categoryTodo, dryRun } from '#commands/lib/standardParams.ts'
 *
 * const params = {
 *   day: dayNoFutureArg(),                  // positional
 *   when: dayNoFutureFlag({ short: 'w' }),  // --when / -w flag
 *   category: categoryTodo(),
 *   dryRun: dryRun(),
 * }
 * ```
 */

import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { Arg, Flag } from '#commands/lib/params.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

// -----------------------------------------------------------------------------
// Day Args (positional)
// -----------------------------------------------------------------------------

/**
 * Day positional arg that rejects future dates. Defaults to today.
 */
export function dayNoFutureArg() {
  return Arg.plainDate('Day (e.g., 27, 8-27, 2025-08-27)', {
    parse: (input: string) => parsePartialDate(input, { rejectFuture: true }),
    default: () => new PlainDate(),
  })
}

/**
 * Day positional arg that allows future dates. Defaults to today.
 */
export function dayArg() {
  return Arg.plainDate('Day (e.g., 27, 8-27, 2025-08-27)', {
    parse: (input: string) => parsePartialDate(input),
    default: () => new PlainDate(),
  })
}

// -----------------------------------------------------------------------------
// Day Flags (named)
// -----------------------------------------------------------------------------

interface DayFlagOptions {
  short?: string
}

/**
 * Day flag that rejects future dates. Defaults to today.
 */
export function dayNoFutureFlag(opts?: DayFlagOptions) {
  return Flag.plainDate('Day (e.g., 27, 8-27, 2025-08-27)', {
    short: opts?.short,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: true }),
    default: () => new PlainDate(),
  })
}

/**
 * Day flag that allows future dates. Defaults to today.
 */
export function dayFlag(opts?: DayFlagOptions) {
  return Flag.plainDate('Day (e.g., 27, 8-27, 2025-08-27)', {
    short: opts?.short,
    parse: (input: string) => parsePartialDate(input),
    default: () => new PlainDate(),
  })
}

/**
 * Category flag returning just the category name ("Professional" or "Personal").
 * Use this with APIs that build the list name internally (e.g., setCompleteItem).
 */
export function category() {
  return Flag.string('Category: "Personal" or "Professional"', {
    short: 'c',
    default: () => 'Professional',
  })
}

/**
 * Category flag for todo operations. Defaults to 'Professional Todos'.
 * Use this with APIs that expect the full list name (e.g., writeDayItems).
 */
export function categoryTodo() {
  return Flag.string('Category: "Personal" or "Professional"', {
    short: 'c',
    parse: (val: string) => `${val} Todos`,
    default: () => 'Professional Todos',
  })
}

/**
 * Normalize a category name: strip an already-present list suffix and fix
 * case variants of the two documented categories, so "-c personal" and
 * "-c 'Personal Complete'" both land on "Personal" instead of growing a
 * doubled suffix. Unknown categories pass through untouched.
 */
function normalizeCategory(val: string): string {
  const base = val.trim().replace(/\s+(?:Complete|Todos)$/i, '')
  const known = ['Personal', 'Professional'].find((k) => k.toLowerCase() === base.toLowerCase())
  return known ?? base
}

/**
 * Category flag for complete operations. Defaults to 'Professional Complete'.
 * Use this with APIs that expect the full list name (e.g., writeDayItems).
 */
export function categoryComplete() {
  return Flag.string('Category: "Personal" or "Professional"', {
    short: 'c',
    parse: (val: string) => `${normalizeCategory(val)} Complete`,
    default: () => 'Professional Complete',
  })
}

/**
 * Dry run flag. Defaults to false.
 */
export function dryRun() {
  return Flag.bool('Preview without changes', {
    short: 'd',
    default: false,
  })
}

/**
 * When flag using notebook time. Defaults to current notebook time.
 */
export function whenNBTime() {
  return Flag.plainDateTime('Date/time', {
    parse: PlainDateTime.fromString,
    default: async () => (await fetchNow()).plainDateTime,
  })
}

/**
 * When flag using system time. Defaults to current system time.
 */
export function when() {
  return Flag.plainDateTime('Date/time', {
    parse: PlainDateTime.fromString,
    default: () => new PlainDateTime(),
  })
}
