import type { ModelMessage } from 'ai'

export function stoppedReply(text = ''): string {
  return [text.trimEnd(), '*Response stopped.*'].filter(Boolean).join('\n\n')
}

/** Keep completed tool exchanges without replaying an unfinished call or an approval request. */
export function stoppedToolMessages(messages: ModelMessage[]): ModelMessage[] {
  const completed = new Set(
    messages.flatMap((message) =>
      typeof message.content === 'string'
        ? []
        : message.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : [])),
    ),
  )
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role !== 'assistant' && message.role !== 'tool') return []
    if (typeof message.content === 'string') return []
    const content = message.content.filter(
      (part) => (part.type === 'tool-call' || part.type === 'tool-result') && completed.has(part.toolCallId),
    )
    // Filtering preserves each message's role-specific content types.
    return content.length ? [{ ...message, content } as ModelMessage] : []
  })
}

/** Approval UI may outlive a turn; cancellation releases the engine's wait independently. */
export async function untilAborted<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return work()
  let abort: () => void = () => {}
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      }),
      work(),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
