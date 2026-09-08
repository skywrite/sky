import type { DayData, ThreadSummary } from './day.tsx'

export interface DayChatRow {
  key: string
  title: string
  time: string
  /** Complete exchanges added by this chat, excluding inherited messages. */
  turns: number
  state: ThreadSummary['state'] | null
  /** The notebook document, also retained while its conversation is live. */
  path: string | null
  /** Where to continue the conversation; independent of opening its document. */
  target: { kind: 'saved'; path: string } | { kind: 'live'; id: string }
  parent: { title: string; turn: number } | null
  depth: number
}

interface ChatNode extends Omit<DayChatRow, 'parent' | 'depth'> {
  parent: { chat: string; turn: number; id?: string | null; title?: string | null } | null
}

function fileTitle(file: string): string {
  return (file.split('/').at(-1) ?? file)
    .replace(/\.md$/, '')
    .replace(/^\d{2}-\d{2}_/, '')
    .replace(/[-_]/g, ' ')
}

/** One tree for the day column and the rail, with a live continuation replacing its saved row. */
export function dayChatRows(ymd: string, chats: DayData['chats'], threads: ThreadSummary[]): DayChatRow[] {
  const savedPaths = new Set(chats.map((chat) => chat.path))
  const live = threads.filter(
    (thread) => !thread.id.startsWith('day-') && (thread.day === ymd || (thread.saved && savedPaths.has(thread.saved))),
  )
  const continued = new Set(live.map((thread) => thread.saved))
  const nodes: ChatNode[] = [
    ...chats
      .filter((chat) => !continued.has(chat.path))
      .map(
        (chat): ChatNode => ({
          key: `saved:${chat.path}`,
          title: chat.summary || fileTitle(chat.path),
          time: chat.time,
          turns: chat.exchanges,
          state: null,
          target: { kind: 'saved', path: chat.path },
          path: chat.path,
          parent: chat.parent,
        }),
      ),
    ...live.map(
      (thread): ChatNode => ({
        key: `live:${thread.id}`,
        title: thread.title ?? (thread.parent ? 'New branch' : 'New chat'),
        time: thread.when ?? chats.find((chat) => chat.path === thread.saved)?.time ?? '',
        turns: Math.floor(Math.max(0, thread.turns - thread.inherited) / 2),
        state: thread.state,
        target: { kind: 'live', id: thread.id },
        path: thread.saved,
        parent: thread.parent,
      }),
    ),
  ]
  const byPath = new Map(nodes.filter((node) => node.path).map((node) => [node.path!, node]))
  const byId = new Map(
    nodes.filter((node) => node.target.kind === 'live').map((node) => [node.key.slice('live:'.length), node]),
  )
  const parentOf = (node: ChatNode) =>
    node.parent ? (byId.get(node.parent.id ?? '') ?? byPath.get(node.parent.chat)) : undefined
  const byTime = (a: ChatNode, b: ChatNode) => b.time.localeCompare(a.time) || a.key.localeCompare(b.key)
  const children = new Map<string, ChatNode[]>()
  for (const node of nodes) {
    const parent = parentOf(node)
    if (!parent) continue
    const siblings = children.get(parent.key) ?? []
    siblings.push(node)
    children.set(parent.key, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => (a.parent?.turn ?? 0) - (b.parent?.turn ?? 0) || byTime(a, b))
  }

  const rows: DayChatRow[] = []
  const seen = new Set<string>()
  const visit = (node: ChatNode, depth: number) => {
    if (seen.has(node.key)) return
    seen.add(node.key)
    rows.push({
      key: node.key,
      title: node.title,
      time: node.time,
      turns: node.turns,
      state: node.state,
      path: node.path,
      target: node.target,
      parent: node.parent
        ? {
            title: parentOf(node)?.title ?? node.parent.title ?? fileTitle(node.parent.chat),
            turn: node.parent.turn,
          }
        : null,
      depth,
    })
    for (const child of children.get(node.key) ?? []) visit(child, depth + 1)
  }
  const ordered = [...nodes].sort(byTime)
  for (const node of ordered.filter((node) => !parentOf(node))) visit(node, 0)
  // Hand-edited parent keys can form a cycle; still show each chat once.
  for (const node of ordered) visit(node, 0)
  return rows
}

export function chatTurnCount(row: DayChatRow): string {
  return `${row.turns}${row.parent ? ' new' : ''} turn${row.turns === 1 ? '' : 's'}`
}

export function chatState(row: DayChatRow): string | null {
  if (row.state === null) return null
  return row.state === 'new' || row.state === 'done' ? 'live' : row.state
}
