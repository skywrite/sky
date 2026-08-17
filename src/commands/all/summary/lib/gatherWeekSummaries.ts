import * as path from 'node:path'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parseSummaryContext } from './contextRecord.ts'

export interface WeekSummaryEntry {
  date: PlainDate
  /** Absolute path of the daily summary file */
  path: string
  /** The daily summary as shipped: whole file minus its SUMMARY-CONTEXT record */
  body: string
  /** The daily's frontmatter rel entries, empty when absent */
  rel: string[]
}

export interface GatherWeekSummariesResult {
  /** Present dailies, in the order the dates were given (chronological for a week) */
  days: WeekSummaryEntry[]
  /** Dates left out of the gather, by reason */
  skipped: {
    missing: PlainDate[]
    tiny: PlainDate[]
    yamlError: PlainDate[]
    unreadable: PlainDate[]
  }
}

const MIN_CONTENT_LENGTH = 50

/**
 * Gather the daily summary.md of each given date as model-ready text.
 *
 * The weekly summary is a record built from records: only summary.md
 * qualifies as a day's input — never day.md or raw day files — so a day
 * without one is reported as missing, not silently substituted. Each daily
 * ships whole (its frontmatter rel: names the day's cast) minus the trailing
 * SUMMARY-CONTEXT record, which is provenance bookkeeping, not content.
 */
export default async function gatherWeekSummaries(
  dates: PlainDate[],
  timeDir: string,
): Promise<GatherWeekSummariesResult> {
  const days: WeekSummaryEntry[] = []
  const skipped: GatherWeekSummariesResult['skipped'] = { missing: [], tiny: [], yamlError: [], unreadable: [] }

  for (const date of dates) {
    const filePath = path.join(timeDir, dayDir(date), 'summary.md')

    if (!(await exists(filePath))) {
      skipped.missing.push(date)
      continue
    }

    let content: string
    try {
      content = await readTextFile(filePath)
    } catch {
      skipped.unreadable.push(date)
      continue
    }

    if (content.length < MIN_CONTENT_LENGTH) {
      skipped.tiny.push(date)
      continue
    }

    const parsed = Document.fromMarkdown(content)
    if (parsed.yamlError) {
      skipped.yamlError.push(date)
      continue
    }

    const rel = parsed.yaml['rel']
    days.push({
      date,
      path: filePath,
      body: parseSummaryContext(content).body,
      rel: Array.isArray(rel) ? rel.filter((r): r is string => typeof r === 'string') : [],
    })
  }

  return { days, skipped }
}
