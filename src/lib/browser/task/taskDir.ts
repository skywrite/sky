import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_HOME } from '#config'
import { slugify } from '#lib/string/mod.ts'
import type { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

/** Every browser task gets a folder here: its files, its report, its server log. Local to this Mac. */
export const SKY_BROWSER_TASKS_DIR = path.join(DIR_HOME, '.sky', 'browser', 'tasks')

export interface TaskDir {
  id: string
  dir: string
  /** Downloads and screenshots */
  filesDir: string
}

/**
 * Claim a folder named after the moment and the task, `<date>_<HHMM>_<summary>`,
 * the notebook's own form. A taken name gets a numbered suffix; the claim is
 * the mkdir itself, so two tasks started together cannot share one.
 */
export async function createTaskDir(
  now: ZonedDateTime,
  objective: string,
  root = SKY_BROWSER_TASKS_DIR,
): Promise<TaskDir> {
  await mkdir(root, { recursive: true })
  const summary = slugify(objective, { preserveCase: true, suggestedLength: 40 }) || 'task'
  const stem = `${now.date}_${now.time.replace(':', '')}_${summary}`
  for (let attempt = 1; ; attempt++) {
    const id = attempt === 1 ? stem : `${stem}-${attempt}`
    const dir = path.join(root, id)
    try {
      await mkdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    const filesDir = path.join(dir, 'files')
    await mkdir(filesDir)
    return { id, dir, filesDir }
  }
}
