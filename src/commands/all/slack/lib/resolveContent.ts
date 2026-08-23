export default function resolveContent(
  content: string,
  userNames: Map<string, string>,
  channelNames: Map<string, string>,
  usergroupNames: Map<string, string> = new Map(),
): string {
  return (
    content
      // W-prefixed ids are Enterprise Grid users; both arrive as @ID from agent-slack
      .replace(/@([UW][A-Z0-9]+)/g, (_match, userId: string) => {
        const name = userNames.get(userId)
        return name ? `@${name}` : `@${userId}`
      })
      .replace(/<#(C[A-Z0-9]+)(?:\|([^>]*))?>/g, (_match, channelId: string, label: string | undefined) => {
        const name = label || channelNames.get(channelId)
        return name ? `#${name}` : `#${channelId}`
      })
      // Usergroup pings pass through agent-slack untouched; the wire label (when
      // present) already carries the handle
      .replace(/<!subteam\^(S[A-Z0-9]+)(?:\|@?([^>]*))?>/g, (_match, subteamId: string, label: string | undefined) => {
        const name = label || usergroupNames.get(subteamId)
        return name ? `@${name}` : `@${subteamId}`
      })
  )
}
