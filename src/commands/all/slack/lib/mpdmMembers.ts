/**
 * Member handles from an mpdm (group DM) channel name.
 * Slack names group DMs `mpdm-alice--bob.smith--carol-1`; on Enterprise Grid
 * the conversations.members endpoint is blocked (enterprise_is_restricted),
 * so this slug is the reliable member source.
 */
export function mpdmMemberHandles(channelName: string | undefined): string[] {
  if (!channelName) return []
  const name = channelName.replace(/^#/, '')
  if (!name.startsWith('mpdm-')) return []
  return name
    .replace(/^mpdm-/, '')
    .replace(/-\d+$/, '')
    .split('--')
    .map((handle) => handle.trim())
    .filter(Boolean)
}
