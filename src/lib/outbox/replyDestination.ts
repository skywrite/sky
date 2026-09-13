import type { Conversation, OutboxRecord } from './types.ts'

/** A promise's source thread is not necessarily the destination of the promised communication. */
export function replyDestination(item: OutboxRecord, conversation: Conversation = item.conversation) {
  const selected = item.requests?.filter((request) => item.requestIds?.includes(request.id)) ?? []
  if (
    selected.some(
      (request) =>
        request.response?.destination === 'separate_conversation' ||
        (request.attention?.basis === 'owner_commitment' && request.response?.destination !== 'source_conversation'),
    )
  )
    return null
  return conversation.target
}
