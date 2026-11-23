import * as path from 'node:path'

/**
 * Where goals live inside the goals folder. Every other module asks here, so
 * the folder names are spelled once.
 *
 * - `active/<name>.md`: a goal being pursued
 * - `reached/<year>/<name>.md`: a goal that was reached
 * - `missed/<year>/<name>.md`: a goal chased to its date that fell short
 * - `dropped/<year>/<name>.md`: a goal the person stopped going after
 * - `archived/<year>/<name>.md`: an ended goal from before endings were
 *   recorded; still read, never written
 * - `<category>.md` directly in the goals folder: an older notebook's
 *   whole-category file (personal.md, professional.md), still read as active
 *
 * The folder decides a goal's status and the file name is its name. Neither is
 * repeated inside the file, where a hand edit could make them disagree.
 */

/** How a goal can end. Each is a folder, with the year it ended inside. */
export const GOAL_ENDINGS = ['reached', 'missed', 'dropped'] as const
export type GoalEnding = (typeof GOAL_ENDINGS)[number]
export type GoalStatus = 'active' | GoalEnding | 'archived'

const ACTIVE = 'active'
const ARCHIVED = 'archived'
const ENDED: readonly string[] = [...GOAL_ENDINGS, ARCHIVED]

export function activeGoalsDir(goalsDir: string): string {
  return path.join(goalsDir, ACTIVE)
}

/** Where a goal goes when it ends: the folder of its ending, under the year it ended. */
export function endedGoalsDir(goalsDir: string, ending: GoalEnding, year: number): string {
  return path.join(goalsDir, ending, String(year))
}

/**
 * The status folder a goal file sits in: its own folder (`active/<name>.md`),
 * or the one above its year (`reached/2026/<name>.md`). Only those two places
 * are read, so a notebook kept somewhere under a folder called "dropped" is
 * not mistaken for one.
 */
function statusFolder(filePath: string): string | undefined {
  const folders = filePath.split(/[\\/]/).slice(0, -1)
  const own = folders.at(-1)
  if (own === ACTIVE || (own !== undefined && ENDED.includes(own))) return own
  const above = folders.at(-2)
  return above !== undefined && ENDED.includes(above) ? above : undefined
}

export function goalStatusFromPath(filePath: string): GoalStatus {
  return (statusFolder(filePath) as GoalStatus | undefined) ?? 'active'
}

/** The name a goal is found and referenced by (`goals/<name>`). */
export function goalNameFromPath(filePath: string): string {
  return path.basename(filePath).replace(/\.md$/, '')
}

/** One file per goal lives in a status folder; anything else is an older whole-category file. */
export function isOneGoalFile(filePath: string): boolean {
  return statusFolder(filePath) !== undefined
}
