import type { AgentSlackMessage } from './types.ts'

export default function collectUserIds(messages: AgentSlackMessage[]): string[] {
  const ids = new Set<string>()
  for (const msg of messages) {
    if (msg.author?.user_id) ids.add(msg.author.user_id)
    const mentions = msg.content?.match(/@(U[A-Z0-9]+)/g)
    if (mentions) {
      for (const m of mentions) ids.add(m.slice(1))
    }
  }
  return [...ids]
}
