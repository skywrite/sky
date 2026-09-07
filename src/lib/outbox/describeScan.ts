import type { ScanReport } from './types.ts'

/** A quiet check must explain its result as clearly as one that produces drafts. */
export function describeOutboxScan(report: ScanReport): string {
  const parts: string[] = []
  if (report.considered) {
    parts.push(`Checked ${report.considered} ${report.considered === 1 ? 'conversation' : 'conversations'}.`)
  }
  if (report.prepared) {
    parts.push(`${report.prepared} ${report.prepared === 1 ? 'item is' : 'items are'} ready for review.`)
  }
  if (report.ignored) {
    parts.push(`${report.ignored} ${report.ignored === 1 ? 'conversation needed' : 'conversations needed'} no reply.`)
  }
  if (report.stale) {
    parts.push(`${report.stale} ${report.stale === 1 ? 'draft needs' : 'drafts need'} another look after new messages.`)
  }
  if (report.failed) {
    parts.push(`${report.failed} ${report.failed === 1 ? 'conversation' : 'conversations'} could not be checked.`)
  }
  if (!report.prepared && !report.ignored && !report.stale && !report.failed) {
    parts.push(
      report.considered || report.pending
        ? 'No new drafts created this pass.'
        : 'No new or changed conversations to check.',
    )
  }
  if (report.pending) parts.push('More saved conversations are waiting. Check again to continue.')
  return parts.join(' ')
}
