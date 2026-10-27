import type { ReportDeliveryRecord, ReportDeliverySettings, ReportDeliveryTarget } from '#lib/workstreams/delivery.ts'

export function reportDeliveryMode(
  medium: string,
  mode: ReportDeliverySettings['mode'],
): ReportDeliverySettings['mode'] {
  return medium === 'email' ? 'review' : mode
}

export function canSendReport(record: Pick<ReportDeliveryRecord, 'status' | 'target'>, medium?: string): boolean {
  return (
    medium !== 'email' &&
    record.target?.medium !== 'email' &&
    (record.target?.medium ?? medium) === 'slack' &&
    (record.status === 'review' || record.status === 'failed')
  )
}

export function slackReportTarget(link: string): ReportDeliveryTarget {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    throw new Error('Paste the full link to the Slack channel or conversation.')
  }
  const match = url.pathname.match(/^\/archives\/([CGD][A-Z0-9]{6,})(?:\/p(\d{7,}))?\/?$/)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.slack.com') || url.username || url.password || !match)
    throw new Error('Choose a Slack channel or conversation link from your workspace.')
  const timestamp = match[2]
  const threadTs =
    url.searchParams.get('thread_ts') || (timestamp ? `${timestamp.slice(0, -6)}.${timestamp.slice(-6)}` : undefined)
  if (threadTs && !/^\d+\.\d+$/.test(threadTs)) throw new Error('The Slack conversation timestamp is invalid.')
  return { medium: 'slack', workspace: `${url.origin}/`, channelId: match[1]!, ...(threadTs ? { threadTs } : {}) }
}

export function reportTargetLink(target?: ReportDeliveryTarget): string {
  if (!target || target.medium !== 'slack') return ''
  return `${target.workspace.replace(/\/$/, '')}/archives/${target.channelId}${target.threadTs ? `/p${target.threadTs.replace('.', '')}` : ''}`
}

export function describeReportTarget(target?: ReportDeliveryTarget): string {
  if (!target) return 'No delivery destination configured'
  if (target.medium === 'email') return `${target.to.join(', ')} · from ${target.account}`
  return reportTargetLink(target)
}

export function reportDeliveryStatus(record: Pick<ReportDeliveryRecord, 'status' | 'receipt' | 'error'>): string {
  if (record.status === 'sent') return record.receipt ? 'Sent · provider receipt recorded' : 'Recorded sent'
  if (record.status === 'sending') return 'Sending · awaiting confirmation'
  if (record.status === 'unknown') return 'Delivery uncertain · checking is required'
  if (record.status === 'failed') return 'Delivery failed'
  if (record.status === 'superseded') return 'Replaced by newer report'
  return 'Ready for your review'
}
