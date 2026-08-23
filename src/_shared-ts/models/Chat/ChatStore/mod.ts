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
import ChatDocument from '../document/mod.ts'
import { reconstructResumeState, type ResumeState } from '../document/resume.ts'

/** One saved transcript as a listing row — no body, no formatting. */
export interface SavedChatRef {
  /** Absolute path to the transcript */
  path: string
  /** Filename time key, `HH:MM` */
  time: string
  /** The saved summary; empty when the file has none (hosts fall back) */
  summary: string
  /** Complete user/assistant pairs */
  exchanges: number
}

/** Everything the save path needs to write a resumed chat back to its file. */
export interface ResumeSession {
  filePath: string
  /** The transcript's own created date; null when it has none — the caller stamps it */
  created: string | null
  summary: string
  rel: string[]
  tags: string[]
  /** false when yaml turns: swallowed following lines — never overwrite those */
  frontmatterHealthy: boolean
  state: ResumeState
}

/**
 * The day's saved chats, newest filename first (the names lead with the
 * `HH-MM` time key, so lexical order is chronological). A missing
 * directory is a day with no chats, not an error.
 */
export async function listDayChats(chatsDir: string): Promise<SavedChatRef[]> {
  if (!(await exists(chatsDir))) return []

  const names: string[] = []
  for await (const entry of readDir(chatsDir)) {
    if (entry.isFile && entry.name.endsWith('.md')) names.push(entry.name)
  }
  names.sort().reverse()

  const rows: SavedChatRef[] = []
  for (const name of names) {
    const doc = ChatDocument.fromMarkdown(await readTextFile(path.join(chatsDir, name)))
    rows.push({
      path: path.join(chatsDir, name),
      time: name.slice(0, 5).replace('-', ':'),
      summary: doc.summary,
      exchanges: Math.floor(doc.conversation.length / 2),
    })
  }
  return rows
}

/**
 * Load a saved transcript into the state a session continues from: the
 * reseedable conversation and recorded context (via reconstructResumeState)
 * plus the frontmatter the save path must carry forward unchanged.
 *
 * A transcript with nothing to resume still loads — an empty
 * `state.conversation` is the caller's signal, not an error here.
 */
export async function loadResumeSession(filePath: string): Promise<ResumeSession> {
  const doc = ChatDocument.fromMarkdown(await readTextFile(filePath))
  const created = doc.yaml['created']

  return {
    filePath,
    created: created === undefined || created === null ? null : String(created),
    summary: doc.summary,
    rel: Array.from(doc.rel),
    tags: Array.from(doc.tags),
    // A malformed `turns:` folds the keys after it into one scalar, so the
    // count parses as a string instead of a number. That reading is the
    // only warning a host gets before a rewrite would drop the swallowed
    // keys — the save path refuses to overwrite when this is false.
    frontmatterHealthy: typeof doc.yaml['turns'] === 'number',
    state: reconstructResumeState(doc),
  }
}
