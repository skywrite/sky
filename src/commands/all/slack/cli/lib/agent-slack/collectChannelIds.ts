import type { AgentSlackMessage } from './types.ts'

export default function collectChannelIds(messages: AgentSlackMessage[]): string[] {
  const ids = new Set<string>()
  for (const msg of messages) {
    for (const [, id] of msg.content?.matchAll(/<#(C[A-Z0-9]+)(?:\|[^>]*)?>/g) ?? []) {
      if (id) ids.add(id)
    }
  }
  return [...ids]
}
