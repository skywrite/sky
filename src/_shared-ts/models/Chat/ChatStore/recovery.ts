import type { ModelMessage } from 'ai'

/** Runtime state kept in a recovery snapshot, never in a filed transcript. */
export interface ChatRecovery {
  version: 1
  /** Provider history, including tool calls, results, and reasoning metadata. */
  modelMessages?: ModelMessage[]
  contextTokens?: number
  /** The host's thread settings and identity. */
  host?: Record<string, unknown>
}

export function readChatRecovery(value: unknown): ChatRecovery | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return undefined
  const raw = value as Record<string, unknown>
  const recovery: ChatRecovery = { version: 1 }
  if (Array.isArray(raw.modelMessages)) recovery.modelMessages = raw.modelMessages as ModelMessage[]
  if (typeof raw.contextTokens === 'number' && Number.isSafeInteger(raw.contextTokens) && raw.contextTokens >= 0)
    recovery.contextTokens = raw.contextTokens
  if (raw.host && typeof raw.host === 'object' && !Array.isArray(raw.host))
    recovery.host = raw.host as Record<string, unknown>
  return recovery
}
