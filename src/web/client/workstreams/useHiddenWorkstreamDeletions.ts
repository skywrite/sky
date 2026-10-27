import { useState } from 'react'
import type { WorkstreamDeletionReceipt } from '#lib/workstreams/types.ts'

const HIDDEN_DELETIONS = 'sky-workstreams-hidden-deletions'

export function useHiddenWorkstreamDeletions() {
  const [hidden, setHidden] = useState<Record<string, string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(HIDDEN_DELETIONS) ?? '{}')
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string'))
    } catch {
      return {}
    }
  })
  const hide = (receipts: WorkstreamDeletionReceipt[]) => {
    const next = Object.fromEntries(receipts.map((receipt) => [receipt.id, receipt.revision]))
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_DELETIONS, JSON.stringify(next))
    } catch {
      // Hiding still works for this visit when browser preferences are unavailable.
    }
  }
  return { hidden, hide }
}
