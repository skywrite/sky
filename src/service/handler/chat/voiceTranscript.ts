import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

export interface SpokenTurn {
  who: 'you' | 'sky' | 'sonny'
  text: string
  interrupted?: boolean
}

/** Keep consecutive speakers in one exchange so text chat's branch and context numbering stay valid. */
export function voiceConversation(turns: readonly SpokenTurn[]): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  for (const turn of turns) {
    const text = turn.text.trim()
    if (!text) continue
    // The opening hello precedes the conversation, rather than inventing a user message for it.
    if (messages.length === 0 && turn.who !== 'you') continue
    const role = turn.who === 'you' ? 'user' : 'assistant'
    const content =
      role === 'user'
        ? text
        : `${turn.who === 'sonny' ? 'Sonny' : 'Sky'}: ${text}${turn.interrupted ? ' [interrupted]' : ''}`
    const last = messages.at(-1)
    if (last?.role === role) last.content += `\n\n${content}`
    else messages.push({ role, content })
  }
  return messages
}

export function isSpokenTurns(value: unknown): value is SpokenTurn[] {
  return (
    Array.isArray(value) &&
    value.length <= 2000 &&
    value.every(
      (turn) =>
        turn &&
        typeof turn === 'object' &&
        ['you', 'sky', 'sonny'].includes(turn.who) &&
        typeof turn.text === 'string' &&
        turn.text.length <= 100_000 &&
        (turn.interrupted === undefined || typeof turn.interrupted === 'boolean'),
    )
  )
}
