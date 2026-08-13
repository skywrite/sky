export default function resolveContent(
  content: string,
  userNames: Map<string, string>,
  channelNames: Map<string, string>,
): string {
  return content
    .replace(/@(U[A-Z0-9]+)/g, (_match, userId: string) => {
      const name = userNames.get(userId)
      return name ? `@${name}` : `@${userId}`
    })
    .replace(/<#(C[A-Z0-9]+)(?:\|([^>]*))?>/g, (_match, channelId: string, label: string | undefined) => {
      const name = label || channelNames.get(channelId)
      return name ? `#${name}` : `#${channelId}`
    })
}
