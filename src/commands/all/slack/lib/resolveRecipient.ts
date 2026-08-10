import type { ConversationType } from './types.ts'

type ThreadReply = {
  userName?: string
  userId?: string
}

type ExportResult = {
  channelId: string
  channelName?: string
  channelMembers?: string[]
  conversationType: ConversationType
  /** The current user's display name — resolved by the export when a DM's author is its partner */
  selfName?: string
  thread?: { replies: ThreadReply[] }
}

/**
 * Determine the "to" field for a Slack message from an export result.
 *
 * - channel: `#channel-name`
 * - dm: the other person in the DM (not the message author).
 *   When the DM partner sent the message (from === partner),
 *   looks in thread replies for the current user's name.
 * - group: all members except the message author
 * - fallback: channel name or ID
 */
export default function resolveRecipient(data: ExportResult, from?: string): string {
  const channel = data.channelName || data.channelId

  if (data.conversationType === 'channel') {
    return `#${channel}`
  }

  if (data.conversationType === 'dm') {
    const partner = data.channelMembers?.[0]
    if (!partner) return channel

    // If the message author is NOT the DM partner, to = partner
    if (!from || from !== partner) return partner

    // The DM partner sent the message — to = the current user.
    // Look in thread replies for a different userName.
    if (data.thread) {
      const otherReply = data.thread.replies.find((r) => r.userName && r.userName !== from)
      if (otherReply?.userName) return otherReply.userName
    }

    // Unanswered DM: the current user never wrote, so their name appears
    // nowhere in the messages — the export resolves it via auth.test instead.
    // Without it (legacy data), fall back to the partner.
    return data.selfName ?? partner
  }

  // Group DM: exclude the message author
  if (data.channelMembers) {
    const others = from
      ? data.channelMembers.filter((name) => name !== from).join(', ')
      : data.channelMembers.join(', ')
    return others || channel
  }

  return channel
}
