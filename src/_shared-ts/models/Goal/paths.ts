import * as path from 'node:path'

/**
 * Where goals live inside the goals folder. Every other module asks here, so
 * the folder names are spelled once.
 *
 * - `active/<name>.md`: a goal being pursued
 * - `archived/<year>/<name>.md`: a goal that was reached or dropped
 * - `<category>.md` directly in the goals folder: an older notebook's
 *   whole-category file (personal.md, professional.md), still read as active
 *
 * The folder decides a goal's status and the file name is its name. Neither is
 * repeated inside the file, where a hand edit could make them disagree.
 */
export type GoalStatus = 'active' | 'archived'

const ACTIVE = 'active'
const ARCHIVED = 'archived'

export function activeGoalsDir(goalsDir: string): string {
  return path.join(goalsDir, ACTIVE)
}

export function goalStatusFromPath(filePath: string): GoalStatus {
  return filePath.includes(`/${ARCHIVED}/`) ? 'archived' : 'active'
}

/** The name a goal is found and referenced by (`goals/<name>`). */
export function goalNameFromPath(filePath: string): string {
  return path.basename(filePath).replace(/\.md$/, '')
}

/** One file per goal lives under active/ or archived/; anything else is an older whole-category file. */
export function isOneGoalFile(filePath: string): boolean {
  return filePath.includes(`/${ACTIVE}/`) || filePath.includes(`/${ARCHIVED}/`)
}
