import type { ThreadState, ThreadSummary } from '../day/day.tsx'

export type SidebarChatDotTone = 'live' | 'working' | 'waiting' | 'failed'
export type SidebarChatStatusTone = 'working' | 'waiting' | 'failed' | 'temp'

export interface SidebarChatRow {
  id: string
  title: string
  depth: number
  dotTone: SidebarChatDotTone
  temporary: boolean
  statusLabel: string | null
  statusTone: SidebarChatStatusTone | null
  tooltip: string
}

function stateDetails(
  state: ThreadState,
  line: string | null,
  temporary: boolean,
): { dotTone: SidebarChatDotTone; statusLabel: string | null; statusTone: SidebarChatStatusTone | null } {
  if (state === 'reading') return { dotTone: 'working', statusLabel: 'Reading notebook…', statusTone: 'working' }
  if (state === 'thinking') return { dotTone: 'working', statusLabel: 'Thinking…', statusTone: 'working' }
  if (state === 'streaming') return { dotTone: 'working', statusLabel: 'Replying…', statusTone: 'working' }
  if (state === 'saving') return { dotTone: 'working', statusLabel: 'Saving…', statusTone: 'working' }
  if (state === 'waiting') return { dotTone: 'waiting', statusLabel: 'Needs your go', statusTone: 'waiting' }
  if (state === 'failed') {
    const interrupted = line?.toLowerCase().includes('restarted') ?? false
    return { dotTone: 'failed', statusLabel: interrupted ? 'Interrupted' : 'Reply failed', statusTone: 'failed' }
  }
  if (temporary) return { dotTone: 'live', statusLabel: 'Temporary', statusTone: 'temp' }
  return { dotTone: 'live', statusLabel: null, statusTone: null }
}

function tooltipOf(thread: ThreadSummary, title: string, todayYmd: string | null): string {
  const parts = [title]
  if (todayYmd && thread.day !== todayYmd) parts.push(thread.day)
  else if (thread.when) parts.push(thread.when)
  if (thread.saves === false) parts.push('Temporary')
  return parts.join(' · ')
}

/**
 * Live chats for the left sidebar: preserves the service's newest-activity-first
 * order for root threads while nesting live branches directly under their live parent.
 */
export function sidebarChatRows(threads: ThreadSummary[], todayYmd: string | null = null): SidebarChatRow[] {
  const live = threads.filter((thread) => !thread.id.startsWith('day-'))
  const byId = new Map(live.map((thread) => [thread.id, thread]))
  const bySaved = new Map(live.filter((thread) => thread.saved).map((thread) => [thread.saved!, thread]))
  const indexOf = new Map(live.map((thread, index) => [thread.id, index]))

  const parentOf = (thread: ThreadSummary): ThreadSummary | undefined => {
    if (!thread.parent) return undefined
    const candidate = (thread.parent.id ? byId.get(thread.parent.id) : undefined) ?? bySaved.get(thread.parent.chat)
    return candidate && candidate.id !== thread.id ? candidate : undefined
  }

  const children = new Map<string, ThreadSummary[]>()
  for (const thread of live) {
    const parent = parentOf(thread)
    if (!parent) continue
    const siblings = children.get(parent.id) ?? []
    siblings.push(thread)
    children.set(parent.id, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (a, b) => (a.parent?.turn ?? 0) - (b.parent?.turn ?? 0) || (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0),
    )
  }

  const rows: SidebarChatRow[] = []
  const seen = new Set<string>()
  const visit = (thread: ThreadSummary, depth: number) => {
    if (seen.has(thread.id)) return
    seen.add(thread.id)
    const title = thread.title ?? (thread.parent ? 'New branch' : 'New chat')
    const temporary = thread.saves === false
    const { dotTone, statusLabel, statusTone } = stateDetails(thread.state, thread.line, temporary)
    rows.push({
      id: thread.id,
      title,
      depth,
      dotTone,
      temporary,
      statusLabel,
      statusTone,
      tooltip: tooltipOf(thread, title, todayYmd),
    })
    for (const child of children.get(thread.id) ?? []) visit(child, depth + 1)
  }

  for (const thread of live) {
    if (!parentOf(thread)) visit(thread, 0)
  }
  // Tolerate cyclic parent pointers so every live chat still renders once.
  for (const thread of live) visit(thread, 0)
  return rows
}
