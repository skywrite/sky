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
      // Slack wraps email addresses as <mailto:addr|label>; keep only the address
      .replace(/<mailto:([^|>]+)(?:\|[^>]*)?>/g, (_match, address: string) => address)
      // Phone numbers arrive as <tel:digits|label>; the label is the number as the
      // sender typed it (formatting intact), so keep it and fall back to the digits
      .replace(/<tel:([^|>]+)(?:\|([^>]*))?>/g, (_match, digits: string, label: string | undefined) => label || digits)
  )
}
