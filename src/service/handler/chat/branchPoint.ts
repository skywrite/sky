import { createHash } from 'node:crypto'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import { withSources } from '#universal/ai/sources.ts'

/** A completed exchange identified by the server, independent of messages kept only on the page. */
export interface BranchPoint {
  turn: number
  key: string
}

/**
 * A reference to each completed reply and the conversation it inherits.
 * Transcript parsing normalizes whitespace and Sources lists, so the keys
 * ignore those formatting differences when a snapshot is read back.
 */
export function branchPoints(turns: readonly ConversationMessage[]): Array<BranchPoint | null> {
  const history = createHash('sha256')
  return turns.map((message, i) => {
    const content = (message.role === 'assistant' ? withSources(message.content.trim(), []) : message.content)
      .trim()
      .replace(/\s+/g, ' ')
    history.update(JSON.stringify([message.role, message.when ?? null, content]))
    if (message.role !== 'assistant' || i % 2 !== 1) return null
    return { turn: (i + 1) / 2, key: history.copy().digest('hex') }
  })
}
