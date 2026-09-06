import ChatDocument from '#shared/models/Chat/document/mod.ts'
import { buildChatTranscript } from '#shared/models/Chat/enrich.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains } from '../filters/mod.ts'
import {
  type DatedFilter,
  type EntitySpec,
  type InvolvesFilter,
  type MappedDay,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getDateForDocument,
  getOptionalStringField,
  matchesDatedFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
} from './shared.ts'

export interface ChatFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  summaryContains?: string
}

export function matchesChatFilter(
  doc: Document,
  filter: ChatFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.summaryContains && !matchesContains(doc, 'summary', filter.summaryContains)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  return true
}

/** The parent key as the file records it, or null. */
function parentOf(doc: Document): { chat: string; turn: number } | null {
  const raw = doc.yaml['parent']
  if (!raw || typeof raw !== 'object') return null
  const { chat, turn } = raw as { chat?: unknown; turn?: unknown }
  return typeof chat === 'string' && chat && typeof turn === 'number' ? { chat, turn } : null
}

/** Whether a collection path is the file a notebook-relative key names. */
function namesFile(collectionPath: string, relative: string): boolean {
  return collectionPath === relative || collectionPath.endsWith(`/${relative}`)
}

/**
 * The whole conversation a chat is, as a transcript: for a branch, its
 * parents' turns through the branch point, then its own; for a chat that
 * began on its own, its turns as written. Parents are looked up among
 * `chats`; a parent the collection does not hold leaves the branch's own
 * turns to stand alone.
 */
function threadOf(doc: Document, chats: Array<{ doc: Document; path: string }>): string {
  const messages: ConversationMessage[] = []
  const seen = new Set<Document>()
  const walk = (current: Document, upTo: number | null) => {
    if (seen.has(current)) return
    seen.add(current)
    const parent = parentOf(current)
    const above = parent ? chats.find((c) => namesFile(c.path, parent.chat)) : undefined
    if (parent && above) walk(above.doc, parent.turn)
    const own = ChatDocument.fromMarkdown(current.markdown).conversation
    // A parent contributes through the branch point only: the turns the whole thread has to that point.
    messages.push(...(upTo === null ? own : own.slice(0, Math.max(0, upTo * 2 - messages.length))))
  }
  walk(doc, null)
  return buildChatTranscript(messages)
}

export function docToChat(doc: Document, path: string, day: MappedDay | null = null) {
  // Chat filenames encode the start time: HH-MM_Slugified-Summary.md
  const timeMatch = path
    .split('/')
    .pop()
    ?.match(/^(\d{2})-(\d{2})_/)
  const turns = doc.yaml['turns']
  const parent = parentOf(doc)

  return {
    date: getDateForDocument(doc, path) ?? '',
    day,
    when: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : null,
    summary: getOptionalStringField(doc, 'summary'),
    provider: getOptionalStringField(doc, 'provider'),
    model: getOptionalStringField(doc, 'model'),
    turns: typeof turns === 'number' ? turns : 0,
    parent: parent ? { path: parent.chat, turn: parent.turn } : null,
    inherited: parent ? parent.turn * 2 : 0,
    ...docBase(doc, path),
  }
}

type ChatRow = ReturnType<typeof docToChat> & { branches: ChatRow[]; thread: string }

export default {
  type: 'chat',
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesChatFilter(doc, filter, path, ctx.resolveNames),
  // Lineage crosses rows: a branch's parents and a parent's branches are
  // other chats, so the batch is mapped against every chat the collection
  // holds, not only the rows the query kept.
  mapper: (ctx) => {
    const chats = ctx.domain.entriesByType('chat')
    const row = (doc: Document, path: string, withBranches: boolean): ChatRow => ({
      ...docToChat(doc, path, ctx.dayFor(doc, path)),
      branches: withBranches
        ? chats
            .filter((c) => {
              const parent = parentOf(c.doc)
              return parent !== null && namesFile(path, parent.chat)
            })
            .map((c) => row(c.doc, c.path, false))
        : [],
      thread: threadOf(doc, chats),
    })
    return (entries) => entries.map(({ doc, path }) => row(doc, path, true))
  },
} satisfies EntitySpec<ChatFilter, ChatRow>
