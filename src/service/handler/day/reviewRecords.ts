import * as path from 'node:path'
import hasEndOrLength from '#commands/all/day/meeting/lib/hasEndOrLength.ts'
import gatherDayDocs from '#commands/all/summary/lib/gatherDayDocs.ts'
import { isActionPath } from '#shared/nbfs/mod.ts'
import { titleOf } from './record.ts'
import { clockMinutes } from './status.ts'

/** Unfinished records offered by the review before its summary is generated. */
export interface DayReviewRecords {
  /** Meeting and event records that state no end time or length, in start order */
  endless: Array<{ start: string; title: string; path: string }>
}

export async function buildReviewRecords(input: {
  dayDirPath: string
  markdownBaseDir: string
}): Promise<DayReviewRecords> {
  const { docs } = await gatherDayDocs(input.dayDirPath)
  const endless = docs
    .filter((entry) => isActionPath('meeting', entry.path) || isActionPath('event', entry.path))
    .flatMap((entry) => {
      const when = entry.doc.yaml['when']
      const start = typeof when === 'string' && !hasEndOrLength(when) ? when.match(/\b(\d{1,3}:\d{2})\b/)?.[1] : null
      return start
        ? [{ start, title: titleOf(entry.doc, entry.path), path: path.relative(input.markdownBaseDir, entry.path) }]
        : []
    })
    .sort((a, b) => (clockMinutes(a.start) ?? 0) - (clockMinutes(b.start) ?? 0))
  return { endless }
}
