import type { ReviewCorrection } from './transcriptRun.ts'

/** Explicit batch approval accepts offered fixes; an issue without a suggestion stays as heard. */
export function acceptSuggestedReviews(
  issues: { originalText: string; suggestedFix?: string | null; occurrences: number }[],
): ReviewCorrection[] {
  return issues.map((issue, issueIndex) => ({
    issueIndex,
    originalText: issue.originalText,
    correction: issue.suggestedFix ?? '',
    occurrences: issue.occurrences,
    action: issue.suggestedFix ? 'accept' : 'skip',
  }))
}
