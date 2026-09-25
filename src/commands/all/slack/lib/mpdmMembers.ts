/**
 * Creation-time handles from an mpdm (group DM) channel name, such as
 * `mpdm-alice--bob.smith--carol-1`. Useful as a display fallback when Grid
 * blocks conversations.members; use live membership for participant matching.
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
