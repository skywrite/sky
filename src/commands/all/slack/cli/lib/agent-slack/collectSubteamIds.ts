export default function collectSubteamIds(messages: { content?: string }[]): string[] {
  const ids = new Set<string>()
  for (const msg of messages) {
    for (const [, id] of msg.content?.matchAll(/<!subteam\^(S[A-Z0-9]+)(?:\|[^>]*)?>/g) ?? []) {
      if (id) ids.add(id)
    }
  }
  return [...ids]
}
