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

export interface ReadChatInput {
  path: string
  offset?: number
}

export type ReadChatOutput =
  | { success: true; path: string; text: string; totalChars?: number; nextOffset?: number }
  | { success: false; error: string }

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

export async function readChat(input: ReadChatInput, notebookDir: string): Promise<ReadChatOutput> {
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
export function createReadChatTool(options: { notebookDir: string }) {
  return {
    [READ_CHAT_TOOL]: tool({
      description:
        "Open a saved chat in full. In your context a past chat shows only its card: frontmatter, title and summary, with a line counting the messages left out. Call this with the path the card came under (time/.../actions/ai-chats/....md) when the answer depends on what was actually said - the user's own words, a draft, figures, the reasons for a decision - rather than the gist. Returns the chat's markdown: frontmatter, title, summary, then the conversation in order. A long chat returns nextOffset; call again with it to read on. Read-only.",
      inputSchema: z.object({
        path: z.string().trim().min(1).describe("The chat's notebook path, as its card names it"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Where to continue a long chat: the previous call's nextOffset"),
      }),
      execute: (input: ReadChatInput) => readChat(input, options.notebookDir),
    }),
  }
}
