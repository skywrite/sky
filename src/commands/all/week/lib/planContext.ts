import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_GOALS, DIR_TIME } from '#config'
import { readTextFile } from '#shared/fs/mod.ts'
import { dayDir, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

const MI_FILE = /^MI\d+\.md$/i
const PLANNING_FILE = /^(commitments|next-|schedule-).*\.md$/

export interface PlanContext {
  sections: { title: string; body: string }[]
}

async function tryRead(filePath: string): Promise<string | undefined> {
  try {
    return await readTextFile(filePath)
  } catch {
    return undefined
  }
}

async function tryList(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
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

  for (const file of (await tryList(DIR_GOALS)).filter((f) => f.endsWith('.md'))) {
    add(`goals/${file}`, await tryRead(path.join(DIR_GOALS, file)))
  }
  for (const file of (await tryList(DIR_TIME)).filter((f) => PLANNING_FILE.test(f))) {
    add(`time/${file}`, await tryRead(path.join(DIR_TIME, file)))
  }

  for (const day of planDayRange(week, today)) {
    const dd = path.join(DIR_TIME, dayDir(day))
    const label = `${day.ymd} ${day.dayShort}`

    for (const file of (await tryList(path.join(dd, 'journal'))).filter((f) => f.endsWith('.md'))) {
      add(`${label} — journal/${file}`, await tryRead(path.join(dd, 'journal', file)))
    }
    for (const file of (await tryList(path.join(dd, 'n'))).filter((f) => MI_FILE.test(f))) {
      add(`${label} — most important: ${file}`, await tryRead(path.join(dd, 'n', file)))
    }

    const summary = await tryRead(path.join(dd, 'summary.md'))
    if (summary?.trim()) add(`${label} — summary`, summary)
    else add(`${label} — day.md (no summary)`, await tryRead(path.join(dd, 'day.md')))
  }

  // today is not a completed day, but its journal is a complete morning
  // artifact — the freshest stated intent the drafter can get
  const todayDir = path.join(DIR_TIME, dayDir(today))
  for (const file of (await tryList(path.join(todayDir, 'journal'))).filter((f) => f.endsWith('.md'))) {
    add(`${today.ymd} ${today.dayShort} (today) — journal/${file}`, await tryRead(path.join(todayDir, 'journal', file)))
  }

  return { sections }
}

export function formatPlanContext(context: PlanContext): string {
  if (!context.sections.length) return '(no notebook context available)'
  return context.sections.map((s) => `<<< ${s.title} >>>\n${s.body}`).join('\n\n')
}
