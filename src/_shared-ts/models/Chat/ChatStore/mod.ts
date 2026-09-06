/**
 * The saved side of a chat: what transcripts a day already holds, and
 * loading one back into the state a live session needs to continue it.
 *
 * This is the read half of the chat store — the third member of the
 * ChatContext/ChatEngine family. It touches the filesystem, which is why
 * it lives here rather than in document/resume.ts (whose derivations stay
 * pure), but it is host-neutral: nothing here prompts or prints. The CLI's
 * --resume picker renders what listDayChats returns and opens the pick
 * with loadResumeSession; a web session lists threads and opens one
 * through the same two calls, so both hosts continue a chat by identical
 * rules.
 */

import * as path from 'node:path'
import { exists, readDir, readTextFile } from '#shared/fs/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { inheritedMessages, joinLineage, prefixOf } from '../document/lineage.ts'
import ChatDocument, { type ChatParent } from '../document/mod.ts'
import { reconstructResumeState, type ResumeState } from '../document/resume.ts'

/** One saved transcript as a listing row — no body, no formatting. */
export interface SavedChatRef {
  /** Absolute path to the transcript */
  path: string
  /** Filename time key, `HH:MM` */
  time: string
  /** The saved summary; empty when the file has none (hosts fall back) */
  summary: string
  /** Complete user/assistant pairs the file itself holds — a branch counts its own, not its parent's */
  exchanges: number
  /** The chat this one branched from, as the file records it; null for a chat that began on its own */
  parent: ChatParent | null
}

/** Everything the save path needs to write a resumed chat back to its file. */
export interface ResumeSession {
  filePath: string
  /** The transcript's own created date; null when it has none — the caller stamps it */
  created: string | null
  summary: string
  rel: string[]
  tags: string[]
  /** Files earlier sessions copied into the day's attachments — carried forward verbatim */
  attachments: Attachment[]
  /** Durable approval keys (`tool:fileId`) earlier sessions blessed — created files and "always" answers */
  approvals: string[]
  /** false when yaml turns: swallowed following lines — never overwrite those */
  frontmatterHealthy: boolean
  /** The whole thread: a branch's parent prefix joined to its own turns */
  state: ResumeState
  /** The chat this one branched from, as the file records it; null for a chat that began on its own */
  parent: ChatParent | null
  /** Messages at the head of `state.conversation` that are the parent's — what the save leaves out again */
  inherited: number
  /** What the file itself holds — the write-back gate compares against this, never the joined thread */
  own: ResumeState
  /** The lineage's files, nearest parent first, absolute — a session never retrieves them into its own context */
  ancestors: string[]
}

export interface LoadResumeOptions {
  /** The notebook root a parent key resolves against; without it a branch loads as its own turns alone */
  baseDir?: string
  /**
   * The file is a crash snapshot, which holds the whole thread already —
   * parent turns included — so no parent is read; the inherited count
   * comes from the parent key instead.
   */
  snapshot?: boolean
}

/**
 * The day's saved chats, newest filename first (the names lead with the
 * `HH-MM` time key, so lexical order is chronological). A folder beside a
 * chat holds its branches; those list too, each with its parent key, so a
 * host can nest them. A missing directory is a day with no chats, not an
 * error.
 */
export async function listDayChats(chatsDir: string): Promise<SavedChatRef[]> {
  if (!(await exists(chatsDir))) return []

  const files: string[] = []
  for await (const entry of readDir(chatsDir)) {
    if (entry.isFile && entry.name.endsWith('.md')) files.push(path.join(chatsDir, entry.name))
    else if (entry.isDirectory) {
      for await (const inner of readDir(path.join(chatsDir, entry.name))) {
        if (inner.isFile && inner.name.endsWith('.md')) files.push(path.join(chatsDir, entry.name, inner.name))
      }
    }
  }
  files.sort((a, b) => path.basename(b).localeCompare(path.basename(a)))

  const rows: SavedChatRef[] = []
  for (const file of files) {
    const doc = ChatDocument.fromMarkdown(await readTextFile(file))
    const name = path.basename(file)
    rows.push({
      path: file,
      time: name.slice(0, 5).replace('-', ':'),
      summary: doc.summary,
      exchanges: Math.floor(doc.conversation.length / 2),
      parent: doc.parent,
    })
  }
  return rows
}

/**
 * Load a saved transcript into the state a session continues from: the
 * reseedable conversation and recorded context (via reconstructResumeState)
 * plus the frontmatter the save path must carry forward unchanged.
 *
 * A branch loads as the whole thread it is: its parent's file is read (and
 * its parent's, up the lineage), the prefix up to the turn it left after is
 * joined to its own turns, and `inherited` says how many messages came
 * from the parent so the save can leave them out again. A parent that
 * cannot be read leaves the branch as its own turns, inherited nothing.
 *
 * A transcript with nothing to resume still loads — an empty
 * `state.conversation` is the caller's signal, not an error here.
 */
export async function loadResumeSession(filePath: string, options: LoadResumeOptions = {}): Promise<ResumeSession> {
  return loadLineage(filePath, options, new Set())
}

async function loadLineage(filePath: string, options: LoadResumeOptions, seen: Set<string>): Promise<ResumeSession> {
  seen.add(filePath)
  const doc = ChatDocument.fromMarkdown(await readTextFile(filePath))
  const created = doc.yaml['created']
  const own = reconstructResumeState(doc)
  const parent = doc.parent

  let state = own
  let inherited = 0
  let ancestors: string[] = []
  if (parent && options.snapshot) {
    // The snapshot carries the parent's turns itself; only the count is the key's.
    inherited = Math.min(inheritedMessages(parent.turn), own.conversation.length)
    if (options.baseDir) ancestors = [path.join(options.baseDir, parent.chat)]
  } else if (parent && options.baseDir) {
    const parentPath = path.join(options.baseDir, parent.chat)
    // A cycle in hand-edited keys must not loop; a missing parent leaves the branch on its own.
    if (!seen.has(parentPath) && (await exists(parentPath))) {
      const above = await loadLineage(parentPath, { baseDir: options.baseDir }, seen)
      const prefix = prefixOf(above.state, parent.turn)
      state = joinLineage(prefix, own)
      inherited = prefix.conversation.length
      ancestors = [parentPath, ...above.ancestors]
    }
  }

  return {
    filePath,
    created: created === undefined || created === null ? null : String(created),
    summary: doc.summary,
    rel: Array.from(doc.rel),
    tags: Array.from(doc.tags),
    attachments: doc.attachments,
    approvals: doc.approvals,
    // A malformed `turns:` folds the keys after it into one scalar, so the
    // count parses as a string instead of a number. That reading is the
    // only warning a host gets before a rewrite would drop the swallowed
    // keys — the save path refuses to overwrite when this is false.
    frontmatterHealthy: typeof doc.yaml['turns'] === 'number',
    state,
    parent,
    inherited,
    own,
    ancestors,
  }
}

/**
 * The lineage above a chat file, nearest parent first, absolute — read
 * from the parent keys, for a context that admits a branch and wants the
 * turns it stands on too. A file with no parent, or one that cannot be
 * read, has none.
 */
export async function ancestorsOf(filePath: string, baseDir: string): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>([filePath])
  let current = filePath
  for (;;) {
    let parent: ChatParent | null
    try {
      parent = ChatDocument.fromMarkdown(await readTextFile(current)).parent
    } catch {
      return found
    }
    if (!parent) return found
    const next = path.join(baseDir, parent.chat)
    if (seen.has(next) || !(await exists(next))) return found
    seen.add(next)
    found.push(next)
    current = next
  }
}
