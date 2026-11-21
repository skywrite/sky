/**
 * Where a saved chat keeps its machine record.
 *
 * A saved chat is two files. The transcript in the notebook holds what a
 * person reads: the frontmatter, the title, the summary and the
 * conversation. What the machine needs to continue the chat — the per-turn
 * context log, the statistics, and the session's recovery state with the
 * model's full history — lives under Sky's state, in a JSON file at the
 * transcript's own notebook-relative path:
 * `time/2026/W05/01-27/actions/ai-chats/09-30_Atlas.md` keeps its log at
 * `<chatLogDir>/time/2026/W05/01-27/actions/ai-chats/09-30_Atlas.json`.
 *
 * The path is the key, so the transcript carries no id for it. A transcript
 * moved or renamed by hand leaves its log behind and opens like any chat
 * without one: the conversation reads whole, and continuing it gathers
 * context afresh.
 *
 * A chat saved before 2026-11-21 carries the log as a trailing comment in
 * the transcript (document/ContextLog). That log is read as before, and it
 * wins over a log file: it is the one that matches the text it sits under.
 * Saving such a chat again moves its log out. Crash snapshots keep the
 * trailing comment; they are state already (autosave.ts).
 */

import { Buffer } from 'node:buffer'
import { mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import {
  type ContextLogDetails,
  type ContextTurnLog,
  contextLogJson,
  embeddedContextLogJson,
  parseContextLog,
  splitContextLog,
} from '../document/ContextLog/mod.ts'
import ChatDocument from '../document/mod.ts'

export interface ChatLogHome {
  /** The notebook root: a chat's log is keyed by the transcript's path beneath it */
  baseDir: string
  /** Where saved chats keep their logs, under Sky's state */
  chatLogDir: string
}

export interface ChatLog {
  entries: ContextTurnLog[]
  details?: ContextLogDetails
}

/** The log folder beside a host's crash snapshots: `<state>/ai/chats/logs`. */
export function chatLogDirOf(snapshotDir: string): string {
  return path.join(snapshotDir, 'logs')
}

/** The log file of a transcript, or null for a transcript outside the notebook, which has nowhere to key one. */
export function chatLogPath(chatFile: string, home: ChatLogHome): string | null {
  const relative = path.relative(home.baseDir, chatFile)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return path.join(home.chatLogDir, `${relative.replace(/\.md$/, '')}.json`)
}

/**
 * A transcript's log: its own trailing comment when it has one, else its
 * log file. A chat with neither, or with a log file that does not read,
 * has no log; it still opens.
 */
export async function readChatLog(chatFile: string, markdown: string, home?: ChatLogHome): Promise<ChatLog> {
  const embedded = splitContextLog(markdown)
  if (embedded.entries.length > 0 || embedded.details) {
    return { entries: embedded.entries, ...(embedded.details ? { details: embedded.details } : {}) }
  }
  const file = home ? chatLogPath(chatFile, home) : null
  if (!file) return { entries: [] }
  let text: string
  try {
    text = await readTextFile(file)
  } catch {
    return { entries: [] }
  }
  return parseContextLog(text) ?? { entries: [] }
}

/**
 * Write a transcript's log file, replacing the one before it whole. Returns
 * where it landed, or null for a transcript outside the notebook: the
 * caller keeps that log in the transcript.
 */
export async function writeChatLog(
  chatFile: string,
  home: ChatLogHome,
  entries: ContextTurnLog[],
  details?: ContextLogDetails,
): Promise<string | null> {
  const file = chatLogPath(chatFile, home)
  if (!file) return null
  await writeLogText(file, `${contextLogJson(entries, details)}\n`)
  return file
}

/** Atomic replace: a crash mid-write must never leave half a log where a whole one was. */
async function writeLogText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`)
  await writeTextFile(tmp, text)
  await rename(tmp, file)
}

/** A line that opens a log comment, readable or not. */
const LOG_OPENER = /^<!-- CONTEXT-LOG$/m

export type ChatLogMove =
  /** The transcript carries no log; there is nothing to move. */
  | { outcome: 'none' }
  /** The log left the transcript, or would on a dry run; `bytes` is what the transcript sheds. */
  | { outcome: 'moved'; bytes: number }
  /** The transcript was left exactly as it was, and why. */
  | { outcome: 'kept'; reason: string }

/**
 * Move the log a transcript carries as its trailing comment into its log
 * file, leaving the transcript as its conversation alone: what saving the
 * chat again does, without a session.
 *
 * The comment's JSON is copied as written, so nothing the log holds is
 * dropped for being unknown to this version. The transcript is rewritten
 * only after the log file reads back as written, and only when the text
 * that remains is the transcript's own up to the comment and reads as the
 * same chat. Anything else is left alone with its reason, since the comment
 * may be the only copy.
 */
export async function moveChatLogOut(
  chatFile: string,
  home: ChatLogHome,
  options: { dryRun?: boolean } = {},
): Promise<ChatLogMove> {
  const raw = await readTextFile(chatFile)
  const json = embeddedContextLogJson(raw)
  if (json === null) {
    return LOG_OPENER.test(raw)
      ? { outcome: 'kept', reason: 'its log does not read as the current version' }
      : { outcome: 'none' }
  }
  const file = chatLogPath(chatFile, home)
  if (!file) return { outcome: 'kept', reason: 'it is outside the notebook, with nowhere to key a log file' }

  const { body } = splitContextLog(raw)
  // A second log left in the text would be read as the chat's own from then on, in place of this one.
  if (LOG_OPENER.test(body)) return { outcome: 'kept', reason: 'it carries more than one log' }
  const before = ChatDocument.fromMarkdown(raw)
  const after = ChatDocument.fromMarkdown(body)
  if (
    !raw.startsWith(body.replace(/\n+$/, '')) ||
    JSON.stringify(after.yaml) !== JSON.stringify(before.yaml) ||
    JSON.stringify(after.conversation) !== JSON.stringify(before.conversation)
  ) {
    return { outcome: 'kept', reason: 'without its log it would not read back as the same chat' }
  }

  const text = `${json}\n`
  const existing = await readTextFile(file).catch(() => null)
  // The same log already there is a move that stopped halfway; any other is not this transcript's to replace.
  if (existing !== null && existing !== text) {
    return { outcome: 'kept', reason: 'a different log file is already at its key' }
  }
  const bytes = Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(body, 'utf8')
  if (options.dryRun) return { outcome: 'moved', bytes }

  if (existing === null) await writeLogText(file, text)
  if ((await readTextFile(file)) !== text) {
    return { outcome: 'kept', reason: 'its log file did not read back as written' }
  }
  const tmp = path.join(path.dirname(chatFile), `.${path.basename(chatFile)}.log-move-tmp`)
  await writeTextFile(tmp, body)
  await rename(tmp, chatFile)
  return { outcome: 'moved', bytes }
}
