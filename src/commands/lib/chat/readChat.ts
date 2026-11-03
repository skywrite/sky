/**
 * read_chat — the chat tool that opens a saved chat in full.
 *
 * Past chats ride in a session's context as their cards: frontmatter, title
 * and summary (ChatContext/chatCard.ts). When the answer depends on what was
 * actually said — the person's own words, a draft, a figure, the reasons for
 * a decision — the model opens the chat by the path its card came under.
 * Read-only: one file in a chats folder of the notebook, comments (the
 * context log among them) left out. Built in like read_file: its output is
 * the chat itself, which has no meaning outside a model turn.
 */

import * as path from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { readTextFile } from '#shared/fs/mod.ts'
import { READ_CHAT_TOOL } from '#shared/models/Chat/ChatContext/chatCard.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { isAIChatPath } from '#shared/nbfs/mod.ts'
import { MAX_TEXT_CHARS } from './fileTools.ts'
import { createFindChatsTool, liveChatId, readLiveChat, type LiveChatAccess } from './liveChats.ts'

export interface ReadChatInput {
  path: string
  offset?: number
  version?: string
}

export type ReadChatOutput =
  | { success: true; path: string; text: string; totalChars?: number; nextOffset?: number }
  | { success: false; error: string }
  | ReturnType<typeof readLiveChat>

/**
 * The file a model-supplied path names, when it is a saved chat inside the
 * notebook; null for anything else. A notebook path written with a leading
 * slash ("/time/...") still means the notebook's.
 */
export function resolveChatPath(input: string, notebookDir: string): string | null {
  const trimmed = input.trim().replace(/^\.\//, '')
  const inside = (file: string) => {
    const relative = path.relative(notebookDir, file)
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  }
  const file =
    path.isAbsolute(trimmed) && !inside(trimmed)
      ? path.resolve(notebookDir, trimmed.replace(/^\/+/, ''))
      : path.resolve(notebookDir, trimmed)
  return inside(file) && file.endsWith('.md') && isAIChatPath(file) ? file : null
}

export async function readChat(
  input: ReadChatInput,
  notebookDir: string,
  liveChats?: LiveChatAccess,
): Promise<ReadChatOutput> {
  const id = liveChatId(input.path)
  if (id !== null) {
    return liveChats
      ? readLiveChat(liveChats, id, input)
      : {
          success: false,
          error: 'Reading open chats is available in the web chat. Here, use a saved chat notebook path.',
        }
  }
  const file = resolveChatPath(input.path, notebookDir)
  if (!file) {
    return {
      success: false,
      error: `${input.path} is not a saved chat. ${READ_CHAT_TOOL} opens a file in a day's actions/ai-chats/ folder, by the path its card came under, such as time/2026/W05/01-26/actions/ai-chats/16-00_Atlas-Launch-Plan.md.`,
    }
  }
  let markdown: string
  try {
    markdown = await readTextFile(file)
  } catch {
    return { success: false, error: `There is no saved chat at ${input.path}.` }
  }
  const text = Document.fromMarkdown(markdown).stripHtmlComments().toMarkdown()
  const offset = Math.min(input.offset ?? 0, text.length)
  const end = offset + MAX_TEXT_CHARS
  return {
    success: true,
    path: path.relative(notebookDir, file),
    text: text.slice(offset, end),
    ...(end < text.length ? { totalChars: text.length, nextOffset: end } : {}),
  }
}

/** Both chat hosts offer it beside read_file; it needs no approval. */
export function createReadChatTool(options: { notebookDir: string; liveChats?: LiveChatAccess }) {
  return {
    ...(options.liveChats ? createFindChatsTool(options.liveChats) : {}),
    [READ_CHAT_TOOL]: tool({
      description:
        "Open a saved chat in full by its notebook path (time/.../actions/ai-chats/....md). A past chat's context card is only a summary; read the transcript when the answer depends on the user's words, drafts, figures, or decisions. A long chat returns nextOffset; call again with it to read on. Read-only." +
        (options.liveChats
          ? ' Also reads another open chat using a path from find_chats, a /thread/<id> or /chat/source/<id> path, or its local Sky URL. Open chats are read fresh on each call. Continue long open chats with BOTH nextOffset and version; if the chat changed, restart at offset 0 without version. Cite the returned source link.'
          : ''),
      inputSchema: z.object({
        path: z.string().trim().min(1).describe('A saved chat notebook path or an open chat path from find_chats'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Where to continue a long chat: the previous call's nextOffset"),
        version: z.string().optional().describe('For an open chat continuation, the version from the previous read'),
      }),
      execute: (input: ReadChatInput) => readChat(input, options.notebookDir, options.liveChats),
    }),
  }
}
