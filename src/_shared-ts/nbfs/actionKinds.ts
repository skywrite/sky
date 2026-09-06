import * as path from 'node:path'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayDir from './dayDir.ts'

/** The folder under a day that holds what happened during it. */
export const ACTIONS_DIR = 'actions'

/**
 * The folder under actions/ for each kind of record a day files. Named
 * here and nowhere else: writers build paths with dayActionDir() and
 * actionKindRel(), readers recognise a kind with isActionPath(), so
 * renaming a folder is one entry here plus a notebook move. A folder
 * may hold more than one segment.
 */
export const ACTION_KIND_DIRS = {
  chat: 'ai-chats',
  doc: 'docs',
  event: 'events',
  image: 'images',
  meeting: 'meetings',
  message: 'messages',
  note: 'notes',
  recap: 'recaps',
  video: 'videos',
} as const

export type ActionKind = keyof typeof ACTION_KIND_DIRS

/** `actions/<kind folder>` — day-relative, the form the day file links with. */
export function actionKindRel(kind: ActionKind): string {
  return `${ACTIONS_DIR}/${ACTION_KIND_DIRS[kind]}`
}

/**
 * A day's folder for one kind of record, relative to time/ like dayDir.
 *
 * @param kind - Which kind of record
 * @param date - PlainDate instance or YMD string (e.g., "2026-03-31")
 * @returns e.g. "2026/W14/03-31/actions/recaps"
 */
export function dayActionDir(kind: ActionKind, date: PlainDate | string): string {
  return path.join(dayDir(date), actionKindRel(kind))
}

/**
 * Whether a path lies inside the kind's folder, at any depth — a chat
 * branch files in a folder beside its parent, still under the day's
 * chats. Absolute or day-relative; only folder segments count, so a
 * file that merely carries a folder's name is not that kind.
 */
export function isActionPath(kind: ActionKind, filePath: string): boolean {
  return hasFolder(filePath, ACTION_KIND_DIRS[kind])
}

/**
 * Whether the folders on the way to `filePath` contain `folder`, which
 * may be a run of segments such as `ai/chats`.
 */
export function hasFolder(filePath: string, folder: string): boolean {
  const folders = filePath.split('/').slice(0, -1)
  const run = folder.split('/')
  for (let start = 0; start + run.length <= folders.length; start++) {
    if (run.every((segment, offset) => folders[start + offset] === segment)) return true
  }
  return false
}
