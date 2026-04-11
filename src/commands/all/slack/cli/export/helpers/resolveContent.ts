export default function resolveContent(content: string, userNames: Map<string, string>): string {
  return content.replace(/@(U[A-Z0-9]+)/g, (_match, userId: string) => {
    const name = userNames.get(userId)
    return name ? `@${name}` : `@${userId}`
  })
}
