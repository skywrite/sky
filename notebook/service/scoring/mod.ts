/**
 * Scoring module - Tracks interaction scores for people and organizations.
 *
 * @example
 * ```typescript
 * import { ScoringStore, INTERACTION_WEIGHTS } from '#service/scoring/mod.ts'
 *
 * const scoring = new ScoringStore()
 * scoring.recordPersonInteraction('Alice', '2026-01-15', INTERACTION_WEIGHTS.meeting)
 * ```
 */

export {
  INTERACTION_WEIGHTS,
  type OrgScore,
  type PersonScore,
  RECENCY_MULTIPLIERS,
  RECENCY_THRESHOLDS,
  ScoringStore,
  type TagScore,
} from './ScoringStore.ts'
