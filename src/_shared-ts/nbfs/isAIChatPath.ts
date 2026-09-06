import { isActionPath } from './actionKinds.ts'

/**
 * Whether a path lies inside a chats folder, at any depth, absolute or
 * day-relative — the chat kind by its own name.
 */
export default function isAIChatPath(filePath: string): boolean {
  return isActionPath('chat', filePath)
}
