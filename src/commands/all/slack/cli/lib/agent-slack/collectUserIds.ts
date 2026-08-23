/** The content/author subset of AgentSlackMessage — later-list bodies qualify too. */
type MentionSource = { content?: string; author?: { user_id?: string } }

export default function collectUserIds(messages: MentionSource[]): string[] {
  const ids = new Set<string>()
  for (const msg of messages) {
    if (msg.author?.user_id) ids.add(msg.author.user_id)
    // W-prefixed ids are Enterprise Grid users
    const mentions = msg.content?.match(/@([UW][A-Z0-9]+)/g)
    if (mentions) {
      for (const m of mentions) ids.add(m.slice(1))
    }
  }
  return [...ids]
}
