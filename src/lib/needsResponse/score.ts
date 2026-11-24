import type { NeedsResponseItem, NeedsResponseKind } from './types.ts'

/** Unanswered messages older than 7 days automatically drop off Needs Response. */
export const NEEDS_RESPONSE_EXPIRY_DAYS = 7
export const NEEDS_RESPONSE_EXPIRY_HOURS = NEEDS_RESPONSE_EXPIRY_DAYS * 24

/**
 * Tunable weights for Needs Response ordering.
 *
 * Higher priority = listed higher on Today.
 * Uses a multiplicative importance model so who the person is genuinely leads
 * while older unanswered messages steadily bubble up:
 *
 *   priority = personBase * ageMultiplier * kindMultiplier
 *
 * - `personBase = max(unscoredFloor, personScore + macContactBonus) ^ personExponent`:
 *   With exponent 0.5 (sqrt), a top contact (score 900 -> 30) clearly outweighs
 *   a regular colleague (score 64 -> 8) or acquaintance (score 9 -> 3), instead
 *   of compressing everyone into a narrow log band. People in Mac Contacts receive
 *   `macContactBonusScore` extra points so known personal/phone contacts are elevated.
 * - `ageMultiplier = 1 + ageScale * log1p(clampedAgeHours / ageHalfStepHours)`:
 *   Waiting 1h -> ~1.05x, 6h -> ~1.24x, 24h -> ~1.56x, 72h -> ~1.90x, 144h -> ~2.13x.
 *   Older unanswered threads bubble steadily without letting a 6-day-old low-score
 *   contact jump ahead of a close contact waiting a few hours.
 * - `directMultiplier`: slight lift for 1:1 DMs and direct @mentions over group threads.
 */
export const NEEDS_RESPONSE_RANK_WEIGHTS = {
  personExponent: 0.5,
  unscoredFloor: 4,
  macContactBonusScore: 60,
  ageScale: 0.35,
  ageHalfStepHours: 6,
  directMultiplier: 1.15,
} as const

/**
 * Jev probability thresholds required to admit a conversation to Needs Response.
 * Tunable independently from Outbox's conservative pre-filter.
 */
export const NEEDS_RESPONSE_SCREEN_THRESHOLDS = {
  needsResponseMin: 0.5,
  ownerAddressedMin: 0.4,
} as const

export function computeNeedsResponsePriority(input: {
  personScore: number
  ageHours: number
  kind: NeedsResponseKind
  inMacContacts?: boolean
}): number {
  const safeScore = Math.max(0, Number.isFinite(input.personScore) ? input.personScore : 0)
  const effectiveScore = safeScore + (input.inMacContacts ? NEEDS_RESPONSE_RANK_WEIGHTS.macContactBonusScore : 0)
  const clampedAge = Math.min(
    NEEDS_RESPONSE_EXPIRY_HOURS,
    Math.max(0, Number.isFinite(input.ageHours) ? input.ageHours : 0),
  )
  const personBase = Math.pow(
    Math.max(NEEDS_RESPONSE_RANK_WEIGHTS.unscoredFloor, effectiveScore),
    NEEDS_RESPONSE_RANK_WEIGHTS.personExponent,
  )
  const ageMultiplier =
    1 + NEEDS_RESPONSE_RANK_WEIGHTS.ageScale * Math.log1p(clampedAge / NEEDS_RESPONSE_RANK_WEIGHTS.ageHalfStepHours)
  const kindMultiplier =
    input.kind === 'dm' || input.kind === 'mention' ? NEEDS_RESPONSE_RANK_WEIGHTS.directMultiplier : 1
  return Math.round(personBase * ageMultiplier * kindMultiplier * 1000) / 1000
}

export function isNeedsResponseExpired(ageHours: number, expiryDays = NEEDS_RESPONSE_EXPIRY_DAYS): boolean {
  return ageHours >= expiryDays * 24
}

export function passesNeedsResponseScreen(verdict: { needsResponse: number; ownerAddressed: number }): boolean {
  return (
    verdict.needsResponse >= NEEDS_RESPONSE_SCREEN_THRESHOLDS.needsResponseMin &&
    verdict.ownerAddressed >= NEEDS_RESPONSE_SCREEN_THRESHOLDS.ownerAddressedMin
  )
}

/** Sort highest priority first, breaking ties by oldest received first, then stable id. */
export function sortNeedsResponseItems(items: readonly NeedsResponseItem[]): NeedsResponseItem[] {
  return [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    if (a.receivedAt !== b.receivedAt) return a.receivedAt.localeCompare(b.receivedAt)
    return a.id.localeCompare(b.id)
  })
}
