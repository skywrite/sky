import type { EntityCandidate } from '#lib/notebook/enrich/resolve.ts'
import { normalizeEntityName } from '#lib/notebook/enrich/resolve.ts'

const MIN_NORM_LENGTH = 3
const MAX_HITS = 8

/**
 * Deterministic no-AI baseline: scan the transcript for known entity names.
 * Matches on the normalized full name with word boundaries; conversation
 * parties are excluded per the rel rule (parties live in from/to, rel is
 * what the conversation is about).
 */
export function scanMentions(body: string, candidates: EntityCandidate[], parties: string[]): string[] {
  const text = ` ${normalizeEntityName(body)} `
  const partyNorms = new Set(parties.map(normalizeEntityName).filter(Boolean))

  const hits: string[] = []
  for (const candidate of candidates) {
    if (candidate.norm.length < MIN_NORM_LENGTH) continue
    if (partyNorms.has(candidate.norm)) continue
    if (!text.includes(` ${candidate.norm} `)) continue
    if (!hits.includes(candidate.ref)) hits.push(candidate.ref)
    if (hits.length >= MAX_HITS) break
  }
  return hits
}
