/**
 * Code-side backstop for the analysis contract's "one issue per distinct problem"
 * rule — models leak per-instance issues regardless of instruction, and every
 * leaked duplicate is either a redundant interactive prompt or a redundant
 * correction entry.
 *
 * Issues are grouped by normalized `originalText`:
 *
 * - A unanimously high-confidence group merges per distinct fix: identical
 *   auto-fixes collapse into one entry, while genuinely divergent fixes stay
 *   separate — applyCorrections() lands the first one transcript-wide and
 *   reports the rest as dropped conflicts (the user is never prompted either way).
 * - Any other group merges to a single issue at the group's most cautious
 *   confidence, divergent fixes offered as options — one prompt rules the term.
 */

export interface DedupableIssue {
  confidence: 'high' | 'medium' | 'low'
  occurrences: number
  originalText: string
  contexts: string[]
  suggestedFix?: string | null
  options?: string[] | null
}

const RANK = { high: 2, medium: 1, low: 0 } as const

/** Contexts are representative samples — more than this is noise, not signal. */
export const MAX_CONTEXTS = 3

/** Canonical form of a transcribed term: case- and whitespace-insensitive. */
export function normalizeTerm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function clone<T extends DedupableIssue>(issue: T): T {
  return {
    ...issue,
    contexts: issue.contexts.slice(0, MAX_CONTEXTS),
    options: issue.options ? [...issue.options] : issue.options,
  }
}

function mergeInto(base: DedupableIssue, dupe: DedupableIssue): void {
  base.occurrences += dupe.occurrences
  if (RANK[dupe.confidence] < RANK[base.confidence]) base.confidence = dupe.confidence
  for (const context of dupe.contexts) {
    if (base.contexts.length >= MAX_CONTEXTS) break
    if (!base.contexts.includes(context)) base.contexts.push(context)
  }
  // An empty-string fix is a deliberate removal, so only fill in for null/undefined.
  if (base.suggestedFix == null && dupe.suggestedFix != null) base.suggestedFix = dupe.suggestedFix
  // A dupe's divergent fix survives as an alternative the user can pick.
  const alternates = [...(dupe.options ?? [])]
  if (dupe.suggestedFix != null) alternates.push(dupe.suggestedFix)
  for (const alt of alternates) {
    if (alt === '' || alt === base.suggestedFix) continue
    base.options ??= []
    if (!base.options.includes(alt)) base.options.push(alt)
  }
}

export function dedupeIssues<T extends DedupableIssue>(issues: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const issue of issues) {
    const key = normalizeTerm(issue.originalText)
    const group = groups.get(key)
    if (group) group.push(issue)
    else groups.set(key, [issue])
  }

  const merged: T[] = []
  for (const group of groups.values()) {
    if (group.every((issue) => issue.confidence === 'high')) {
      // Sub-group by fix so divergent high-confidence fixes stay separate.
      const byFix = new Map<string, T>()
      for (const issue of group) {
        const fixKey = normalizeTerm(issue.suggestedFix ?? '')
        const base = byFix.get(fixKey)
        if (base) mergeInto(base, issue)
        else byFix.set(fixKey, clone(issue))
      }
      merged.push(...byFix.values())
    } else {
      // Highest confidence first so its fix becomes the suggestion; merging
      // still lowers the confidence to the group's most cautious level.
      const sorted = [...group].sort((a, b) => RANK[b.confidence] - RANK[a.confidence])
      const base = clone(sorted[0])
      for (const dupe of sorted.slice(1)) mergeInto(base, dupe)
      merged.push(base)
    }
  }
  return merged
}
