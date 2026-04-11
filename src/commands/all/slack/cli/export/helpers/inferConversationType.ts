import type { ConversationType } from './types.ts'

export default function inferConversationType(channelId: string): ConversationType {
  if (channelId.startsWith('D')) return 'dm'
  if (channelId.startsWith('G')) return 'group'
  if (channelId.startsWith('C')) return 'channel'
  return 'unknown'
}
