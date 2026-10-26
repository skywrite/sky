import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import { isActionPath, parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import { splitContextLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { type ChatParent } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { isThreadSnapshot, listChatAutosaves } from './autosave.ts'
import { readChatRecovery } from './recovery.ts'

export interface ChatDayCount {
  when: string
  turns: number
}

/** Extended hours keep the notebook date written on the message. */
export function chatActivityDays(messages: readonly ConversationMessage[]): Record<string, ChatDayCount> {
  const days: Record<string, ChatDayCount> = {}
  for (const message of messages) {
    const stamp = message.when?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2,3}:\d{2})$/)
    if (!stamp) continue
    const day = (days[stamp[1]] ??= { when: stamp[2], turns: 0 })
    day.when = stamp[2]
    if (message.role === 'user') day.turns++
  }
  return days
}

export interface DayChatActivity {
  id: string | null
  path: string | null
  title: string
  started: string
  filedDay: string
  day: string
  open: boolean
  parent: ChatParent | null
  messages: ConversationMessage[]
}

interface ChatRecord extends Omit<DayChatActivity, 'day'> {
  saves: boolean
}

export interface ChatActivityOptions {
  timeDir: string
  baseDir: string
  snapshotDir?: string
  documents?: () => Array<{ path: string; doc: Document }>
}

/** One reader per host: unchanged transcripts are parsed once, never enriched or filed by a read. */
export function createChatActivityReader(options: ChatActivityOptions) {
  const cache = new Map<string, { revision: string | Document; record: ChatRecord }>()
  const read = async (
    file: string,
    snapshot?: { id: string; started: string },
    document?: Document,
  ): Promise<ChatRecord> => {
    const info = document ? null : await stat(file)
    const revision = document ?? `${info!.mtimeMs}:${info!.size}`
    const cached = cache.get(file)
    if (cached?.revision === revision) return cached.record
    const raw = document?.toMarkdown() ?? (await readTextFile(file))
    const doc = ChatDocument.fromMarkdown(raw)
    if (doc.yamlError) throw new Error('The chat has invalid frontmatter.')
    if (doc.legacyShape) throw new Error('The chat needs migration to the current transcript format.')
    const host = snapshot
      ? (readChatRecovery(doc.yaml['recovery']) ?? splitContextLog(doc.markdown).details?.session)?.host
      : undefined
    const saved = snapshot ? (typeof host?.saved === 'string' ? path.resolve(options.baseDir, host.saved) : null) : file
    const home = saved ?? doc.parent?.chat
    const filedDay = home ? parseDateFromDayPath(home).ymd : snapshot!.started
    const started = typeof doc.yaml['created'] === 'string' ? doc.yaml['created'].slice(0, 10) : filedDay
    // Recovery includes inherited turns; the saved branch already contains only its own.
    const inherited = snapshot && doc.parent ? doc.parent.turn * 2 : 0
    const record: ChatRecord = {
      id: snapshot?.id ?? null,
      path: saved,
      title: typeof host?.title === 'string' ? host.title : doc.summary || path.basename(file, '.md'),
      started,
      filedDay,
      open: Boolean(snapshot),
      saves: host?.saves !== false,
      parent: doc.parent,
      messages: doc.conversation.slice(inherited),
    }
    cache.set(file, { revision, record })
    return record
  }
  return async function readDay(
    day: string,
    retryClosing = true,
  ): Promise<{ chats: DayChatActivity[]; errors: string[] }> {
    const records = new Map<string, ChatRecord>()
    const seen = new Set<string>()
    const errors: string[] = []
    // Capture live identities before listing files. If one closes during the read,
    // repeat once so its newly filed transcript cannot fall between the two lists.
    const snapshots = options.snapshotDir ? (await listChatAutosaves(options.snapshotDir)).filter(isThreadSnapshot) : []
    let closedDuringRead = false
    const entries: Array<{ path: string; doc?: Document }> = options.documents?.() ?? []
    if (!options.documents && (await exists(options.timeDir))) {
      for await (const entry of walk(options.timeDir, { includeDirs: false, exts: ['.md'] })) {
        if (isActionPath('chat', entry.path)) entries.push({ path: entry.path })
      }
    }
    for (const entry of entries) {
      if (!isActionPath('chat', entry.path)) continue
      seen.add(entry.path)
      try {
        records.set(entry.path, await read(entry.path, undefined, entry.doc))
      } catch (error) {
        const raw = entry.doc?.toMarkdown() ?? (await readTextFile(entry.path).catch(() => ''))
        let filedDay: string | undefined
        try {
          filedDay = parseDateFromDayPath(entry.path).ymd
        } catch {
          // A misplaced file can still contain dated activity from this day.
        }
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (filedDay === day || raw.includes(day)))
          errors.push(`${path.relative(options.baseDir, entry.path)}: ${(error as Error).message}`)
      }
    }
    for (const snapshot of snapshots) {
      if (snapshot.session.startsWith('day-')) continue
      seen.add(snapshot.path)
      try {
        const record = await read(snapshot.path, { id: snapshot.session, started: snapshot.startTime.date })
        // A temporary continuation does not authorize keeping its new messages in a summary.
        if (record.saves) records.set(record.path ?? snapshot.path, record)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') closedDuringRead = true
        else errors.push(`Open chat ${snapshot.session}: ${(error as Error).message}`)
      }
    }
    if (closedDuringRead && retryClosing) return readDay(day, false)
    for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file)
    const chats: DayChatActivity[] = []
    for (const record of records.values()) {
      const messages = record.messages.filter((message) =>
        message.when ? message.when.slice(0, 10) === day : record.filedDay === day,
      )
      if (messages.length) chats.push({ ...record, day, messages })
    }
    return { chats, errors }
  }
}
