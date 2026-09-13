import type { OutboxRecord } from './types.ts'

/** A scanner's unverified legacy result is pending work, not a confirmed decision for the owner. */
export function awaitingAttention(item: OutboxRecord): boolean {
  if (
    item.status !== 'needs_review' ||
    item.edited ||
    item.native ||
    item.reviews.length ||
    item.workstreams?.length ||
    item.origin === 'followup' ||
    item.origin === 'workstream'
  )
    return false
  const selected = item.requests?.filter((request) => item.requestIds?.includes(request.id))
  return !item.requestAnalysis || !selected?.length || selected.some((request) => !request.attention)
}

export function attentionQueue(items: OutboxRecord[]) {
  return {
    items: items.filter((item) => !awaitingAttention(item)),
    awaitingCheck: items.filter(awaitingAttention),
  }
}
