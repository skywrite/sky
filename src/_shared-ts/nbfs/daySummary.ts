import { stat } from 'node:fs/promises'
import * as path from 'node:path'

/** The saved summary is the completion marker; legacy day frontmatter does not close a day. */
export function daySummaryPath(dayFile: string): string {
  return path.join(path.dirname(dayFile), 'summary.md')
}

export async function hasDaySummary(dayFile: string): Promise<boolean> {
  try {
    return (await stat(daySummaryPath(dayFile))).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
