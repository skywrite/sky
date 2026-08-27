import extractWorkspaceUrl from '#commands/all/slack/lib/extractWorkspaceUrl.ts'

export type ParsedChannelTarget = {
  /** Channel id when the target names one directly (URL or bare id) */
  channelId?: string
  /** #name form, without the leading # */
  channelName?: string
  /** Workspace base URL when the target carries one */
  workspaceUrl?: string
}

/**
 * Parse a channel target as users hand it over: a channel or message URL
 * (https://ws.slack.com/archives/C012ABC…), a #name, or a bare channel id.
 * Returns undefined for anything that names no channel.
 */
export default function parseChannelTarget(target: string): ParsedChannelTarget | undefined {
  const trimmed = target.trim()

  const archive = trimmed.match(/^https:\/\/[^/]+\/archives\/([A-Z0-9]+)(?:\/|$)/)
  if (archive) {
    return { channelId: archive[1], workspaceUrl: extractWorkspaceUrl(trimmed) }
  }

  if (trimmed.startsWith('#') && trimmed.length > 1) {
    return { channelName: trimmed.slice(1) }
  }

  if (/^[CDG][A-Z0-9]{6,}$/.test(trimmed)) {
    return { channelId: trimmed }
  }

  return undefined
}
