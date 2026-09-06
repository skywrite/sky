import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { ACTION_KIND_DIRS, dayActionDir } from './actionKinds.ts'

/** The chats folder's name, for the one place that prints the layout to a person. */
export const AI_CHATS_DIR = ACTION_KIND_DIRS.chat

/**
 * A day's chats folder, relative to time/ like dayDir — the chat kind by
 * its own name.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2026-03-31")
 * @returns e.g. "2026/W14/03-31/actions/ai-chats"
 */
export default function dayAIChatsDir(date: PlainDate | string): string {
  return dayActionDir('chat', date)
}
