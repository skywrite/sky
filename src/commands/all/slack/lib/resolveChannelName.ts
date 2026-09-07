/**
 * Spoken-name → conversation id, for draft targets. agent-slack cannot
 * resolve channel names on an Enterprise Grid (`enterprise_is_restricted`
 * even on `channel list`), so sky resolves them itself over the user
 * token, and hands agent-slack the id — the form that works everywhere.
 *
 * Matching is deliberately conservative: only a unique exact name match
 * resolves. Near matches come back as suggestions for the caller (or the
 * voice assistant) to put to the user — "scoreboard" naming three real
 * channels must be a question, never a guess.
 */

import type { WebClient } from '@slack/web-api'

export interface NamedChannel {
  id: string
  name: string
}

export type ChannelPick =
  | { kind: 'match'; channel: NamedChannel }
  | { kind: 'suggestions'; channels: NamedChannel[] }
  | { kind: 'none' }

const MAX_SUGGESTIONS = 6

function normalize(name: string): string {
  return name.replace(/^#/, '').trim().toLowerCase()
}

/** Unique exact name → match; exact ties or contains-hits → suggestions; else none. */
export function pickChannelByName(channels: NamedChannel[], query: string): ChannelPick {
  const q = normalize(query)
  if (!q) return { kind: 'none' }

  const exact = channels.filter((c) => normalize(c.name) === q)
  if (exact.length === 1) return { kind: 'match', channel: exact[0] }
  if (exact.length > 1) return { kind: 'suggestions', channels: exact.slice(0, MAX_SUGGESTIONS) }

  const near = channels.filter((c) => normalize(c.name).includes(q))
  if (near.length > 0) return { kind: 'suggestions', channels: near.slice(0, MAX_SUGGESTIONS) }
  return { kind: 'none' }
}

/** Every active channel (public + private) the token can see, paginated. */
export async function fetchNamedChannels(client: WebClient): Promise<NamedChannel[]> {
  const channels: NamedChannel[] = []
  let cursor: string | undefined
  do {
    const response = await client.users.conversations({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    })
    for (const ch of response.channels ?? []) {
      if (ch.id && ch.name) channels.push({ id: ch.id, name: ch.name })
    }
    cursor = response.response_metadata?.next_cursor || undefined
  } while (cursor)
  return channels
}

/** Conversation and user ids pass through untouched; anything else is a name to resolve. */
export function looksLikeConversationId(target: string): boolean {
  return /^[CDGUW][A-Z0-9]{5,}$/.test(target)
}
