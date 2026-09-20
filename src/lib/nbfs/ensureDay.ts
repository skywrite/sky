import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { exists } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayFile } from './createDayFile.ts'

/** Create one unstarted day when needed. Existing plans and concurrent creators are preserved. */
export async function ensureDay(day: PlainDate, timeDir = DIR_TIME): Promise<boolean> {
  const file = path.join(timeDir, dayFile(day))
  if (await exists(file)) return false
  return createDayFile(file, DayDocument.createFutureDay(day).toMarkdown())
}
