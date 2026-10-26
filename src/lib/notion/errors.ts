/** Why a Notion call failed: the sign-in, the network, the request, or the tool itself. */
export type NotionFailure = 'unauthorized' | 'unavailable' | 'request' | 'tool'

/** A failure in words the settings page and a chat can show as they are. */
export class NotionError extends Error {
  constructor(
    message: string,
    readonly kind: NotionFailure,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'NotionError'
  }
}

export const NOTION_NOT_CONNECTED = 'Notion is not connected. Connect it in Settings → Connections → Notion.'
export const NOTION_SIGNED_OUT =
  'Notion no longer accepts Sky’s sign-in. Connect Notion again in Settings → Connections → Notion.'
export const NOTION_UNREACHABLE = 'Sky could not reach Notion. Check the internet connection and try again.'
