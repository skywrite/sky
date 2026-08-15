/**
 * Timeframe-coverage guard for AI-extracted lookback windows.
 *
 * The extraction model (ai:context:date) reliably pulls explicit dates out of
 * a message but cannot be trusted with the calendar arithmetic that turns
 * "since March 1 of 2025" into a duration — it rounds to a familiar bucket
 * ("1y") that lands short and silently excludes the oldest span the user
 * asked for. The date it extracted is exact, so coverage is computed here
 * instead of trusted from the model.
 *
 * Invariant: stated dates are a floor for the window, never a ceiling. This
 * only ever widens `since` or leaves it alone — "my meeting with Jane on
 * Friday" must not shrink a 30d window down to 2d.
 */

import { parseDuration } from '#shared/models/DomainCollection/query/filters/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface SinceResolution {
  since: string
  /** Earliest stated date the window was widened to reach, when it was. */
  widenedToCover?: string
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

/**
 * Enforce window ⊇ stated dates on an extracted `{ since, dates }` pair.
 *
 * - `since` already covering every past date (or empty = all history): unchanged.
 * - `since` shorter than the gap to a stated past date: widened to exactly
 *   reach it (+1 day cushioning notebook-day vs system-day skew).
 * - `since` unparseable: dropped to all-history — it would otherwise throw
 *   inside the query executor — never re-derived from the dates, which bound
 *   nothing (floor, not ceiling).
 * - Future dates are planning horizons, not lookbacks; unparseable dates are
 *   skipped. Neither ever narrows or fails the resolution.
 */
export function widenSinceToCoverDates(since: string, dates: string[], today: PlainDate): SinceResolution {
  let windowDays: number | undefined
  if (since !== '') {
    try {
      windowDays = parseDuration(since)
    } catch {
      return { since: '', droppedInvalid: since }
    }
  }

  let earliest: { date: string; gap: number } | undefined
  for (const raw of dates) {
    let gap: number
    try {
      gap = toEpochDays(today) - toEpochDays(PlainDate.from(raw))
    } catch {
      continue
    }
    if (!Number.isFinite(gap) || gap <= 0) continue
    if (!earliest || gap > earliest.gap) earliest = { date: raw, gap }
  }

  if (!earliest) return { since }
  if (windowDays === undefined) return { since } // all history already covers every date
  if (windowDays >= earliest.gap) return { since }

  return { since: `${earliest.gap + 1}d`, widenedToCover: earliest.date }
}
