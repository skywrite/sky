import * as path from 'node:path'
import {
  type ContextSection,
  formatSections,
  readDayJournals,
  readDayMostImportant,
  readDayNarration,
  readGoals,
  tryList,
  tryRead,
} from '#commands/lib/notebookContext.ts'
import { DIR_TIME } from '#config'
import { weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate, type Week } from '#universal/dates/nbdt/mod.ts'

const PLANNING_FILE = /^(commitments|next-|schedule-).*\.md$/

export interface PlanContext {
  sections: ContextSection[]
}

/**
 * The days whose lived record feeds the plan: all of the previous week, plus
 * the target week's COMPLETED days — strictly before notebook-today. Planning
 * a future week contributes no target-week days, correctly.
 */
export function planDayRange(week: Week, today: PlainDate): PlainDate[] {
  return [...week.previous().days, ...week.days].filter((day) => PlainDate.compare(day, today) < 0)
}

/**
 * Best-effort gather of what the drafter should see. Missing or empty files
 * are skipped silently — a new notebook yields no sections and the flow is
 * interview-only.
 */
export async function gatherPlanContext(week: Week, today: PlainDate): Promise<PlanContext> {
  const sections: PlanContext['sections'] = []
  const add = (title: string, body: string | undefined) => {
    if (body?.trim()) sections.push({ title, body: body.trim() })
  }

  const prev = week.previous()
  add(`Last week's plan (${prev.toString()})`, await tryRead(path.join(DIR_TIME, weekDir(prev.startInYear), 'week.md')))

  for (const goal of await readGoals()) add(`goals/${goal.name}`, goal.body)
  for (const file of (await tryList(DIR_TIME)).filter((f) => PLANNING_FILE.test(f))) {
    add(`time/${file}`, await tryRead(path.join(DIR_TIME, file)))
  }

  for (const day of planDayRange(week, today)) {
    const label = `${day.ymd} ${day.dayShort}`

    for (const file of await readDayJournals(day)) add(`${label} — journal/${file.name}`, file.body)
    for (const file of await readDayMostImportant(day)) add(`${label} — most important: ${file.name}`, file.body)

    const narration = await readDayNarration(day)
    if (narration) add(`${label} — ${narration.kind === 'summary' ? 'summary' : 'day.md (no summary)'}`, narration.body)
  }

  // today is not a completed day, but its journal is a complete morning
  // artifact — the freshest stated intent the drafter can get
  for (const file of await readDayJournals(today)) {
    add(`${today.ymd} ${today.dayShort} (today) — journal/${file.name}`, file.body)
  }

  return { sections }
}

export function formatPlanContext(context: PlanContext): string {
  if (!context.sections.length) return '(no notebook context available)'
  return formatSections(context.sections)
}
