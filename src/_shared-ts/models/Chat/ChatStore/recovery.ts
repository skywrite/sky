import type { ModelMessage } from 'ai'

/** Runtime continuation kept in recovery snapshots and the saved transcript's JSON metadata. */
export interface ChatRecovery {
  version: 1
  /** Matches the readable conversation before restoring persisted provider history. */
  historyKey?: string
  /** Provider history, including tool calls, results, and reasoning metadata. */
  modelMessages?: ModelMessage[]
  contextTokens?: number
  legalReview?: { id: string; turn: number }
  /** The host's thread settings and identity. */
  host?: Record<string, unknown>
}

export function readChatRecovery(value: unknown): ChatRecovery | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return undefined
  const raw = value as Record<string, unknown>
  const recovery: ChatRecovery = { version: 1 }
  if (raw.legalReview && typeof raw.legalReview === 'object') {
    const review = raw.legalReview as Record<string, unknown>
    if (
      typeof review.id === 'string' &&
      typeof review.turn === 'number' &&
      Number.isSafeInteger(review.turn) &&
      review.turn >= 0
    )
      recovery.legalReview = { id: review.id, turn: review.turn }
  }
  if (Array.isArray(raw.modelMessages)) recovery.modelMessages = raw.modelMessages as ModelMessage[]
  if (typeof raw.historyKey === 'string') recovery.historyKey = raw.historyKey
  if (typeof raw.contextTokens === 'number' && Number.isSafeInteger(raw.contextTokens) && raw.contextTokens >= 0)
    recovery.contextTokens = raw.contextTokens
  if (raw.host && typeof raw.host === 'object' && !Array.isArray(raw.host))
    recovery.host = raw.host as Record<string, unknown>
  return recovery
}
