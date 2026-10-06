import type { ModelMessage } from 'ai'
import { WRITING_DRAFT_ID } from '#lib/writingVoice/draftId.ts'
import { readWorkingContext, type WorkingContextState } from '../ChatEngine/workingContext.ts'
import type { ConversationMessage } from '../type.d.ts'

/** Runtime continuation kept in recovery snapshots and the saved transcript's JSON metadata. */
export interface ChatRecovery {
  version: 1
  /** Matches the readable conversation before restoring persisted provider history. */
  historyKey?: string
  /** Provider history, including tool calls, results, and reasoning metadata. */
  modelMessages?: ModelMessage[]
  workingContext?: WorkingContextState
  turnErrors?: { at: number; message: string }[]
  contextTokens?: number
  legalReview?: { id: string; turn: number }
  writingDrafts?: { id: string; turn: number }[]
  writingDraftFocus?: string
  /** The host's thread settings and identity. */
  host?: Record<string, unknown>
}

export function readChatRecovery(value: unknown): ChatRecovery | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return undefined
  const raw = value as Record<string, unknown>
  const recovery: ChatRecovery = { version: 1 }
  const workingContext = readWorkingContext(raw.workingContext)
  if (workingContext) recovery.workingContext = workingContext
  if (Array.isArray(raw.turnErrors))
    recovery.turnErrors = raw.turnErrors.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const value = entry as Record<string, unknown>
      return Number.isSafeInteger(value.at) && (value.at as number) >= 0 && typeof value.message === 'string'
        ? [{ at: value.at as number, message: value.message.slice(0, 2000) }]
        : []
    })
  if (Array.isArray(raw.writingDrafts)) {
    recovery.writingDrafts = raw.writingDrafts.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []
      const value = entry as Record<string, unknown>
      return typeof value.id === 'string' &&
        WRITING_DRAFT_ID.test(value.id) &&
        typeof value.turn === 'number' &&
        Number.isSafeInteger(value.turn) &&
        value.turn >= 0
        ? [{ id: value.id, turn: value.turn }]
        : []
    })
    if (
      typeof raw.writingDraftFocus === 'string' &&
      recovery.writingDrafts.some((ref) => ref.id === raw.writingDraftFocus)
    )
      recovery.writingDraftFocus = raw.writingDraftFocus
  }
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

export function turnErrors(conversation: readonly ConversationMessage[]) {
  return conversation.flatMap((turn, at) => (turn.error ? [{ at, message: turn.error }] : []))
}
