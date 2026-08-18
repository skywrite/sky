/**
 * Window-coverage guard for AI-extracted lookback windows.
 *
 * The extraction model (ai:context:date) reliably pulls explicit dates out of
 * a message but cannot be trusted with the calendar arithmetic that turns
 * "since March 1 of 2025" into a duration — it rounds to a familiar bucket
 * ("1y") that lands short and silently excludes the oldest span the user
 * asked for. The dates it extracted are exact, so coverage is computed here
 * instead of trusted from the model.
 *
 * The window is [today − since, until || today]. Invariant: every stated
 * past date lies inside it. Stated dates are a floor for the window, never
 * a ceiling — this widens the start or extends the end, and never narrows:
 * "my meeting with Jane on Friday" must not shrink a 30d window down to 2d.
 */

import { parseDuration } from '#shared/models/DomainCollection/query/filters/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface WindowResolution {
  since: string
  /** Stated end of the window (YYYY-MM-DD), empty when it runs to now. */
  until: string
  /**
   * Exact start of a closed range (YYYY-MM-DD), present only when `until`
   * is. The user's stated `from` when they named one (widened to the
   * earliest stated date if one falls before it), else derived as
   * today − since. Range-mode consumers should prefer this over
   * re-deriving from the duration — an over-generous duration guess would
   * bleed the range start earlier than the user said.
   */
  start?: string
  /** Earliest stated date the window start was widened to reach, when it was. */
  widenedToCover?: string
  /** Latest stated date the window end was extended to reach, when it was. */
  extendedToCover?: string
  /** The original duration, when an unparseable one was dropped to all-history. */
  droppedInvalid?: string
}

/**
 * Days since 1970-01-01 by pure civil-calendar arithmetic (Howard Hinnant's
 * days_from_civil) — no clock, and JS Date is banned repo-wide.
 */
function toEpochDays(date: PlainDate): number {
  const y = date.month <= 2 ? date.year - 1 : date.year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (date.month > 2 ? date.month - 3 : date.month + 9) + 2) / 5) + date.day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Days from `raw` to today; undefined when unparseable, negative when future. */
function gapDays(raw: string, today: PlainDate): number | undefined {
  try {
    const gap = toEpochDays(today) - toEpochDays(PlainDate.from(raw))
    return Number.isFinite(gap) ? gap : undefined
  } catch {
    return undefined
  }
}

export interface WindowInput {
  /** Extracted lookback duration ("6mo"), "" when none stated. */
  since: string
  /** Extracted start of a stated range (YYYY-MM-DD), "" when none. */
  from: string
  /** Extracted end of a stated range (YYYY-MM-DD), "" when it runs to now. */
  until: string
  /** Specific dates mentioned (YYYY-MM-DD). */
  dates: string[]
  today: PlainDate
}

/**
 * Enforce window ⊇ stated dates on an extracted `{ since, from, until, dates }`.
 *
 * - `since` already covering every past date (or empty = all history): kept.
 * - `since` shorter than the gap to a stated past date (`from` counts as
 *   one): widened to exactly reach it (+1 day cushioning notebook-day vs
 *   system-day skew).
 * - `since` unparseable: dropped to all-history — it would otherwise throw
 *   inside the query executor — never re-derived from the dates, which bound
 *   nothing (floor, not ceiling).
 * - `until` in the past closes the window there; a stated past date beyond it
 *   extends it. A future or unparseable `until` is a planning horizon, not a
 *   bound — dropped so the window runs to now.
 * - With an end in effect, `start` resolves the range's exact first day:
 *   the stated `from` (widened to the earliest stated date when one falls
 *   before it), else today − since. A `from` that is future, unparseable,
 *   or after the end is ignored.
 * - Future stated dates are planning horizons and unparseable dates are
 *   skipped. Neither ever narrows or fails the resolution.
 */
export function resolveWindow(input: WindowInput): WindowResolution {
  const { from, dates, today } = input
  let since = input.since

  // A duration the executor can't parse would throw mid-query downstream —
  // drop to all-history (empty), which covers everything the message named.
  let windowDays: number | undefined
  let droppedInvalid: string | undefined
  if (since !== '') {
    try {
      windowDays = parseDuration(since)
    } catch {
      droppedInvalid = since
      since = ''
    }
  }

  // Bounds only count when they name real past dates.
  let resolvedUntil = input.until
  if (resolvedUntil !== '') {
    const gap = gapDays(resolvedUntil, today)
    if (gap === undefined || gap < 0) resolvedUntil = ''
  }
  let statedFrom = from
  if (statedFrom !== '') {
    const gap = gapDays(statedFrom, today)
    if (gap === undefined || gap <= 0) statedFrom = ''
  }

  // A stated start is a stated date: it participates in the coverage floor.
  let earliest: { date: string; gap: number } | undefined
  let latest: { date: string; gap: number } | undefined
  for (const raw of statedFrom ? [statedFrom, ...dates] : dates) {
    const gap = gapDays(raw, today)
    if (gap === undefined || gap <= 0) continue
    if (!earliest || gap > earliest.gap) earliest = { date: raw, gap }
    if (!latest || gap < latest.gap) latest = { date: raw, gap }
  }

  // End coverage: a stated past date beyond the stated end extends it.
  let extendedToCover: string | undefined
  if (resolvedUntil !== '' && latest) {
    const untilGap = gapDays(resolvedUntil, today)!
    if (latest.gap < untilGap) {
      resolvedUntil = latest.date
      extendedToCover = latest.date
    }
  }

  // Start coverage: widen since when it misses the earliest stated date.
  let widenedToCover: string | undefined
  if (earliest && windowDays !== undefined && windowDays < earliest.gap) {
    // +1 cushions notebook-day vs system-day skew.
    since = `${earliest.gap + 1}d`
    windowDays = earliest.gap + 1
    widenedToCover = earliest.date
  }

  // Range mode resolves an exact start: the stated from (already widened to
  // the earliest date via the floor above — earliest ≤ from by selection),
  // else derived from the duration.
  let start: string | undefined
  if (resolvedUntil !== '') {
    const untilGap = gapDays(resolvedUntil, today)!
    if (statedFrom && gapDays(statedFrom, today)! >= untilGap) {
      start = earliest && earliest.gap > gapDays(statedFrom, today)! ? earliest.date : statedFrom
    } else if (windowDays !== undefined) {
      start = today.addDays(-windowDays).toString()
    }
  }

  return {
    since,
    until: resolvedUntil,
    ...(start ? { start } : {}),
    ...(widenedToCover ? { widenedToCover } : {}),
    ...(extendedToCover ? { extendedToCover } : {}),
    ...(droppedInvalid ? { droppedInvalid } : {}),
  }
}
