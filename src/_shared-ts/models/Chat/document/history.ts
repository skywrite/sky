import { createHash } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { withSources } from '#universal/ai/sources.ts'
import type { ConversationMessage } from '../type.d.ts'

/** A hand-edited transcript must not silently resume an older model conversation. */
export function conversationKey(messages: readonly ConversationMessage[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        messages.map((message) => [
          message.role,
          (message.role === 'assistant' ? withSources(message.content.trim(), []) : message.content)
            .trim()
            .replace(/\s+/g, ' '),
        ]),
      ),
    )
    .digest('hex')
}

/** Preserve tool results and native attachments through the selected completed exchange. */
export function modelHistoryThrough(messages: ModelMessage[], turn: number): ModelMessage[] {
  let users = 0
  const end = messages.findIndex((message) => message.role === 'user' && ++users > turn)
  return structuredClone(end < 0 ? messages : messages.slice(0, end))
}

/** Some invokers return prose without provider history. The readable transcript remains the fallback. */
export function hasCompleteModelHistory(
  messages: ModelMessage[],
  conversation: readonly ConversationMessage[],
): boolean {
  return (
    messages.filter((message) => message.role === 'user').length ===
      conversation.filter((message) => message.role === 'user').length &&
    messages.at(-1)?.role === conversation.at(-1)?.role
  )
}
