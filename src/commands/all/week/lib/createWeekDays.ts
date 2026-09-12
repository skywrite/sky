import * as path from 'node:path'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { exists } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import type { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

/** A future move may have created one day already. Fill the gaps and keep that plan intact. */
export async function createWeekDays(week: Week, timeDir: string, render: (day: PlainDate) => string) {
  const created: string[] = []
  const existing: string[] = []
  for (const day of week.days) {
    const file = path.join(timeDir, dayFile(day))
    if ((await exists(file)) || !(await createDayFile(file, render(day)))) existing.push(day.ymd)
    else created.push(day.ymd)
  }
  return { created, existing }
}
