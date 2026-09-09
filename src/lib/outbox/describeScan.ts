import { rangeLabel } from './range.ts'
import type { ScanReport } from './types.ts'

export function outboxScanSeverity(report: ScanReport & { error?: string }): 'info' | 'error' {
  if (report.error || report.failed) return 'error'
  if (report.outcome !== 'failed') return 'info'
  const coverageOnly =
    report.incomplete &&
    report.total !== undefined &&
    report.completed === report.total &&
    report.pending <= report.incomplete
  return coverageOnly ? 'info' : 'error'
}

/** A quiet check must explain its result as clearly as one that produces drafts. */
export function describeOutboxScan(report: ScanReport): string {
  const parts: string[] = []
  if (report.total !== undefined && report.completed !== undefined) {
    parts.push(
      `Checked ${report.completed} of ${report.total} saved conversations for ${report.range ? rangeLabel(report.range) : report.date}.`,
    )
  } else if (report.considered) {
    parts.push(`Checked ${report.considered} ${report.considered === 1 ? 'conversation' : 'conversations'}.`)
  }
  if (report.prepared) {
    parts.push(`${report.prepared} ${report.prepared === 1 ? 'item needs' : 'items need'} your review.`)
  }
  if (report.ignored) {
    parts.push(`${report.ignored} ${report.ignored === 1 ? 'conversation needed' : 'conversations needed'} no reply.`)
  }
  if (report.answered) parts.push(`${report.answered} already answered.`)
  if (report.incomplete)
    parts.push(
      `${report.incomplete} ${report.incomplete === 1 ? 'conversation needs' : 'conversations need'} source verification because saved context or message times are incomplete.`,
    )
  if (report.stale) {
    parts.push(`${report.stale} ${report.stale === 1 ? 'draft needs' : 'drafts need'} another look after new messages.`)
  }
  if (report.failed) {
    parts.push(`${report.failed} ${report.failed === 1 ? 'conversation' : 'conversations'} could not be checked.`)
  }
  if (report.unchanged) parts.push(`${report.unchanged} already checked and unchanged.`)
  if (
    !report.prepared &&
    !report.ignored &&
    !report.stale &&
    !report.failed &&
    !report.answered &&
    !report.incomplete
  ) {
    parts.push(
      report.considered || report.pending || report.unchanged
        ? 'No additional review items found.'
        : 'No saved conversations to check.',
    )
  }
  const unchecked =
    report.total !== undefined && report.completed !== undefined
      ? Math.max(0, report.total - report.completed)
      : Math.max(0, report.pending - (report.incomplete ?? 0) - report.failed)
  if (unchecked)
    parts.push(`${unchecked} ${unchecked === 1 ? 'conversation still needs' : 'conversations still need'} checking.`)
  if (unchecked || report.failed) parts.push('Check again to retry those conversations.')
  else if (!report.pending && !report.incomplete && report.total !== undefined)
    parts.push('The selected range is checked.')
  return parts.join(' ')
}
