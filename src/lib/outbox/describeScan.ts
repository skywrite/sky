import { rangeLabel } from './range.ts'
import type { ScanReport } from './types.ts'

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
    parts.push(`${report.incomplete} have incomplete context or uncertain message times; coverage is not complete.`)
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
  if (report.pending) parts.push(`${report.pending} still need checking. Check again to retry the incomplete work.`)
  else if (report.total !== undefined) parts.push('The selected range is checked.')
  return parts.join(' ')
}
