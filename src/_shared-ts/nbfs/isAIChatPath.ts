import { AI_CHATS_DIR } from './dayAIChatsDir.ts'

/**
 * Whether a path lies inside a chats folder, at any depth. A branch files
 * in a folder beside its parent, still under the day's chats, so depth
 * does not matter. Absolute or day-relative; only folder segments count,
 * so a file that merely carries the folder's name is not a chat.
 */
export default function isAIChatPath(filePath: string): boolean {
  return filePath.split('/').slice(0, -1).includes(AI_CHATS_DIR)
}
