import { normalizeTerm } from './dedupeIssues.ts'

/**
 * Deterministic transcript correction — literal find→replace, no model.
 *
 * The analysis + review steps produce exact {originalText → correction} pairs;
 * this applies them. Its predecessor asked a model to re-emit the entire
 * corrected transcript, so output — and runtime — scaled with meeting length
 * until 1.5-hour meetings blew past provider time ceilings, and every rewrite
 * risked drift on text nothing asked it to touch. Replacement can do neither.
 *
 * Matching, per correction:
 * - Word-boundary guarded where the needle's edge is a word character, so
 *   "um" never hits "umbrella".
 * - Case-insensitive; a match already spelled as the correction is left
 *   alone and not counted.
 * - A whitespace-flexible pass follows for multi-word needles, flexible only
 *   within a line so a needle can never fuse two speaker turns.
 * - An empty correction is a removal and consumes one trailing space.
 *
 * Safety rules, reported per entry rather than silently skipped:
 * - Needles under 3 characters are refused (too promiscuous to replace blind).
 * - One fix per distinct term: the first entry wins; a divergent second fix
 *   for the same term is dropped as a conflict. (The old rewrite resolved
 *   those per-instance by context; blind replacement cannot.)
 * - Longest needle first, so a short term can't eat a longer phrase's match.
 */

export interface CorrectionInput {
  originalText: string
  correction: string
  /** Instance count the analysis step estimated; actual replacements are reported against it. */
  occurrences: number
}

export interface AppliedCorrection extends CorrectionInput {
  replaced: number
}

export type DropReason = 'not-found' | 'conflict' | 'too-short'

export interface DroppedCorrection extends CorrectionInput {
  reason: DropReason
}

export interface ApplyCorrectionsResult {
  text: string
  applied: AppliedCorrection[]
  dropped: DroppedCorrection[]
  totalReplacements: number
}

/** Needles shorter than this are refused: too promiscuous to replace blind. */
export const MIN_NEEDLE_LENGTH = 3

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bounded(body: string, needle: string): string {
  const lead = /^\w/.test(needle) ? '\\b' : ''
  const tail = /\w$/.test(needle) ? '\\b' : ''
  return lead + body + tail
}

function patternsFor(needle: string, removal: boolean): RegExp[] {
  const suffix = removal ? ' ?' : ''
  const exact = bounded(escapeRegex(needle), needle)
  const flexible = bounded(needle.trim().split(/\s+/).map(escapeRegex).join('[^\\S\\n]+'), needle)
  const sources = flexible === exact ? [exact] : [exact, flexible]
  return sources.map((source) => new RegExp(source + suffix, 'gi'))
}

/**
 * How often a needle occurs in the text, by the boundary and case rules a
 * correction is applied with — so a count taken here is the count the
 * replacer will report. Zero for a needle the replacer would refuse.
 */
export function countOccurrences(text: string, needle: string): number {
  if (needle.trim().length < MIN_NEEDLE_LENGTH) return 0
  return text.match(patternsFor(needle, false)[0])?.length ?? 0
}

export function applyCorrections(text: string, corrections: CorrectionInput[]): ApplyCorrectionsResult {
  const applied: AppliedCorrection[] = []
  const dropped: DroppedCorrection[] = []

  const keptByTerm = new Map<string, CorrectionInput>()
  const kept: CorrectionInput[] = []
  for (const correction of corrections) {
    if (correction.originalText.trim().length < MIN_NEEDLE_LENGTH) {
      dropped.push({ ...correction, reason: 'too-short' })
      continue
    }
    const term = normalizeTerm(correction.originalText)
    const first = keptByTerm.get(term)
    if (!first) {
      const entry = { ...correction }
      keptByTerm.set(term, entry)
      kept.push(entry)
    } else if (first.correction === correction.correction) {
      first.occurrences += correction.occurrences
    } else {
      dropped.push({ ...correction, reason: 'conflict' })
    }
  }

  kept.sort((a, b) => b.originalText.length - a.originalText.length)

  let current = text
  let totalReplacements = 0
  for (const correction of kept) {
    // Spelling confirmed as-is — nothing to change; count instances for the report.
    if (correction.correction === correction.originalText) {
      const matches = current.match(patternsFor(correction.originalText, false)[0])
      applied.push({ ...correction, replaced: matches?.length ?? 0 })
      continue
    }

    let replaced = 0
    for (const pattern of patternsFor(correction.originalText, correction.correction === '')) {
      current = current.replace(pattern, (match) => {
        if (match === correction.correction) return match
        replaced++
        return correction.correction
      })
    }

    if (replaced > 0) {
      applied.push({ ...correction, replaced })
      totalReplacements += replaced
    } else {
      dropped.push({ ...correction, reason: 'not-found' })
    }
  }

  return { text: current, applied, dropped, totalReplacements }
}
