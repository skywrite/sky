import type { OutboxRecord } from '#lib/outbox/types.ts'
import type { WritingVoice } from './agent.ts'

/** Capture accepted text before starting the optional learning conversation. */
export async function captureOutboxRevision(
  voice: WritingVoice,
  before: OutboxRecord,
  after: OutboxRecord,
  accepted = false,
) {
  const original =
    before.draft !== after.draft
      ? before.draft
      : accepted && before.replyDirections?.length
        ? before.originalDraft
        : after.draft
  if (!original.trim() || original === after.draft) return null
  return voice.store.capture({
    source: `outbox:${after.id}`,
    medium: after.conversation.medium,
    recipient: after.recipient ?? '',
    context: after.situation,
    original,
    revised: after.draft,
    instruction:
      after.replyDirections
        ?.map((direction) => direction.text)
        .join('\n')
        .slice(-4000) ?? '',
  })
}
