export default function extractWorkspaceUrl(link: string): string | undefined {
  try {
    const url = new URL(link.trim())
    if (url.hostname.endsWith('.slack.com') && url.hostname !== 'app.slack.com') {
      return `${url.protocol}//${url.hostname}`
    }
  } catch {
    /* skip */
  }
  return undefined
}
