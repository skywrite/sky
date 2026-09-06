import * as path from 'node:path'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayDir from './dayDir.ts'

/** The folder under a day that holds what happened during it. */
export const ACTIONS_DIR = 'actions'

/**
 * The kind folder for saved ai:chat transcripts. Named here and nowhere
 * else: writers build the path with dayAIChatsDir(), readers recognise one
 * with isAIChatPath(), so renaming the folder is this string plus a
 * notebook move.
 */
export const AI_CHATS_DIR = 'ai-chats'

/**
 * A day's chats folder, relative to time/ like dayDir.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2026-03-31")
 * @returns e.g. "2026/W14/03-31/actions/ai-chats"
 */
export default function dayAIChatsDir(date: PlainDate | string): string {
  return path.join(dayDir(date), ACTIONS_DIR, AI_CHATS_DIR)
}
