import type { LaterConversation } from './conversations.ts'

export type ConversationQuery = {
  text: string
  scope: 'all' | 'channel' | 'dm' | 'group'
  patterns: string[]
  wildcard: boolean
}

const normalize = (value: string): string => value.trim().toLowerCase()

export function parseConversationQuery(value: string): ConversationQuery | undefined {
  const text = normalize(value)
  const scope = text.startsWith('#') ? 'channel' : text.startsWith('@') ? 'dm' : text.includes(',') ? 'group' : 'all'
  const patterns =
    scope === 'group'
      ? text.split(',').map(normalize)
      : [scope === 'channel' || scope === 'dm' ? text.slice(1).trim() : text]
  if (patterns.some((pattern) => !pattern || /^[#@]/.test(pattern)) || (scope === 'channel' && text.includes(',')))
    return undefined
  return { text, scope, patterns, wildcard: text.includes('*') }
}

/** Only * is special. Punctuation in names cannot accidentally broaden a capture. */
function matches(value: string, pattern: string): boolean {
  const regex = pattern
    .split(/\*+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regex}$`, 'su').test(normalize(value))
}

function matchesParticipants(conversation: LaterConversation, patterns: string[]): boolean {
  if (!conversation.membersComplete || conversation.members.length !== patterns.length) return false
  // Bipartite matching gives each query a distinct participant, including overlapping wildcards.
  const assigned = new Map<number, number>()
  const assign = (patternIndex: number, visited: Set<number>): boolean => {
    for (const [index, member] of conversation.members.entries()) {
      if (visited.has(index) || !member.aliases.some((alias) => matches(alias, patterns[patternIndex]))) continue
      visited.add(index)
      const previous = assigned.get(index)
      if (previous === undefined || assign(previous, visited)) {
        assigned.set(index, patternIndex)
        return true
      }
    }
    return false
  }
  return patterns.every((_, index) => assign(index, new Set()))
}

export function conversationMatches(conversation: LaterConversation, query: ConversationQuery): boolean {
  const pattern = query.patterns[0]
  if (query.scope === 'all' && !query.wildcard && normalize(conversation.id) === pattern) return true
  if (query.scope === 'channel')
    return conversation.kind === 'channel' && conversation.aliases.some((name) => matches(name, pattern))
  if (query.scope === 'dm')
    return conversation.kind === 'dm' && conversation.aliases.some((name) => matches(name, pattern))
  if (query.scope === 'group') return conversation.kind === 'group' && matchesParticipants(conversation, query.patterns)
  if (conversation.kind === 'unknown') return false
  // Raw slugs are an explicit escape hatch when live membership is unavailable.
  if (conversation.kind === 'group' && pattern.startsWith('mpdm-')) return matches(conversation.rawName ?? '', pattern)
  if (conversation.kind === 'group' && !query.wildcard && !conversation.membersComplete) return false
  return conversation.aliases
    .filter((name) => name !== conversation.rawName || conversation.kind !== 'group')
    .some((name) => matches(name, pattern))
}

const kindLabel = { channel: 'channel', dm: 'DM', group: 'group DM', unknown: 'type unavailable' } as const

export function describeConversation(conversation: LaterConversation): string {
  const label = conversation.kind === 'dm' ? `@${conversation.label}` : conversation.label
  const members =
    conversation.kind === 'group' && !conversation.membersComplete ? '; participants unavailable — use ID' : ''
  return `${label} — ${kindLabel[conversation.kind]}, ${conversation.count} item${conversation.count === 1 ? '' : 's'} (${conversation.id})${members}`
}

export function selectConversations(
  conversations: Map<string, LaterConversation>,
  query?: ConversationQuery,
): { ids: Set<string>; lines: string[]; error?: string } {
  const all = [...conversations.values()]
  const explicitId =
    query?.scope === 'all' && !query.wildcard
      ? all.find((conversation) => normalize(conversation.id) === query.patterns[0])
      : undefined
  const matched = explicitId
    ? [explicitId]
    : query
      ? all.filter((conversation) => conversationMatches(conversation, query))
      : all
  const sorted = (values: LaterConversation[]): LaterConversation[] =>
    [...values].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  if (query && !query.wildcard && matched.length > 1) {
    return {
      ids: new Set(),
      lines: [],
      error: `Ambiguous --channel: ${query.text}. Choose #channel, @person, or a conversation ID:\n${sorted(matched)
        .map((conversation) => `  ${describeConversation(conversation)}\n    --channel '${conversation.id}'`)
        .join('\n')}`,
    }
  }
  let lines: string[] = []
  if (query) {
    const available = all.filter((conversation) => query.scope === 'all' || conversation.kind === query.scope)
    const shown = matched.length ? matched : available
    lines = [
      matched.length ? 'Matched conversations:' : 'No matching saved items. Available conversations in this fetch:',
      ...sorted(shown).map((conversation) => `  ${describeConversation(conversation)}`),
    ]
    if (shown.length === 0) lines.push('  (none)')
    const unknown = all.filter((conversation) => conversation.kind === 'unknown' && conversation.rawName)
    if (query.scope !== 'all' && unknown.length) {
      lines.push(
        'Conversation types could not be verified for these items; select by ID:',
        ...sorted(unknown).map((conversation) => `  ${describeConversation(conversation)}`),
      )
    }
  }
  return { ids: new Set(matched.map((conversation) => conversation.id)), lines }
}
