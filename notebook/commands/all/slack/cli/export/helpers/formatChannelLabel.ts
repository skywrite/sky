import type { ConversationType } from './types.ts'

export default function formatChannelLabel(
  channelId: string,
  conversationType: ConversationType,
  channelName?: string,
): string {
  const typeLabel = `(${channelId}, ${conversationType})`
  if (!channelName) return typeLabel
  if (conversationType === 'channel') {
    return `#${channelName} ${typeLabel}`
  }
  return `${channelName} ${typeLabel}`
}
