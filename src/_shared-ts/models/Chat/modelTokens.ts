import type { ContextAdjustment } from '#universal/ai/contextAdjustment.ts'
import { modelTokens } from '#universal/ai/readingBudget.ts'
import type { RebuildReport } from './ChatContext/mod.ts'
import type { TurnStats } from './document/ContextLog/mod.ts'

/**
 * The context pipeline measures the notebook at four characters a token; a
 * person reads every count in the model's own tokens. These restate the
 * pipeline's counts at a session's ratio (universal/ai/readingBudget.ts).
 * The saved log keeps its estimates; hosts restate them as they show them.
 */

export function statsInModelTokens(stats: TurnStats, ratio: number): TurnStats {
  return {
    ...stats,
    docTokens: modelTokens(stats.docTokens, ratio),
    ...(stats.budget !== undefined ? { budget: modelTokens(stats.budget, ratio) } : {}),
    ...(stats.requestBudget !== undefined ? { requestBudget: modelTokens(stats.requestBudget, ratio) } : {}),
  }
}

/** Documents or tool calls, each with its own count restated. */
export function countsInModelTokens<T extends { tokens?: number }>(records: readonly T[], ratio: number): T[] {
  return records.map((record) =>
    record.tokens === undefined ? record : { ...record, tokens: modelTokens(record.tokens, ratio) },
  )
}

export function adjustmentInModelTokens(adjustment: ContextAdjustment, ratio: number): ContextAdjustment {
  return adjustment.notebookTokens === undefined
    ? adjustment
    : { ...adjustment, notebookTokens: modelTokens(adjustment.notebookTokens, ratio) }
}

export function reportInModelTokens(report: RebuildReport, ratio: number): RebuildReport {
  return {
    ...report,
    ...(report.stats ? { stats: statsInModelTokens(report.stats, ratio) } : {}),
    joined: countsInModelTokens(report.joined, ratio),
    added: countsInModelTokens(report.added, ratio),
    kept: countsInModelTokens(report.kept, ratio),
    cut: countsInModelTokens(report.cut, ratio),
  }
}
