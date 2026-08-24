import * as path from 'node:path'
import colors from 'picocolors'
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
  /** One line per source consulted — printed by the command so the run shows
   * exactly what the drafter saw, above all which days had a real summary.
   * Lines carry terminal colors (green = summary rode, yellow = fallback or
   * missing, red = a lived day contributed nothing). */
  manifest: string[]
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
 * contribute no section — a new notebook yields no sections and the flow is
 * interview-only — but every source consulted lands in the manifest, so the
 * user can see per day whether its summary rode or was missing.
 */
export async function gatherPlanContext(week: Week, today: PlainDate): Promise<PlanContext> {
  const sections: PlanContext['sections'] = []
  const manifest: string[] = []
  const add = (title: string, body: string | undefined): boolean => {
    if (!body?.trim()) return false
    sections.push({ title, body: body.trim() })
    return true
  }
  const count = (name: string, n: number) => (n > 1 ? `${name} ×${n}` : name)

  const prev = week.previous()
  const prevDir = path.join(DIR_TIME, weekDir(prev.startInYear))
  const hasPlan = add(`Last week's plan (${prev.toString()})`, await tryRead(path.join(prevDir, 'week.md')))
  // the weekly summary re-tells the dailies read below at altitude — what
  // moved, decisions, open loops — worth the overlap when it exists
  const hasSummary = add(`Last week's summary (${prev.toString()})`, await tryRead(path.join(prevDir, 'summary.md')))
  const mark = (has: boolean) => (has ? colors.green('✓') : colors.yellow('missing'))
  manifest.push(`${prev.toString()}: plan ${mark(hasPlan)} · summary ${mark(hasSummary)}`)

  const goalCount = (await readGoals()).filter((goal) => add(`goals/${goal.name}`, goal.body)).length
  const planning: string[] = []
  for (const file of (await tryList(DIR_TIME)).filter((f) => PLANNING_FILE.test(f)).sort()) {
    if (add(`time/${file}`, await tryRead(path.join(DIR_TIME, file)))) planning.push(file)
  }
  manifest.push(`goals ×${goalCount} · time/: ${planning.join(', ') || '(none)'}`)

  for (const day of planDayRange(week, today)) {
    const label = `${day.ymd} ${day.dayShort}`

    const journals = (await readDayJournals(day)).filter((file) => add(`${label} — journal/${file.name}`, file.body))
    const mi = (await readDayMostImportant(day)).filter((file) =>
      add(`${label} — most important: ${file.name}`, file.body),
    )

    const narration = await readDayNarration(day)
    let dayNote = colors.red('NO summary')
    if (
      narration &&
      add(`${label} — ${narration.kind === 'summary' ? 'summary' : 'day.md (no summary)'}`, narration.body)
    ) {
      dayNote =
        narration.kind === 'summary' ? colors.green('summary ✓') : colors.yellow('NO summary — day.md rode instead')
    }

    const parts = [dayNote]
    if (journals.length) parts.push(count('journal', journals.length))
    if (mi.length) parts.push(count('MI', mi.length))
    manifest.push(`${label}: ${parts.join(' · ')}`)
  }

  // today is not a completed day, but its journal is a complete morning
  // artifact — the freshest stated intent the drafter can get
  const todayJournals = (await readDayJournals(today)).filter((file) =>
    add(`${today.ymd} ${today.dayShort} (today) — journal/${file.name}`, file.body),
  )
  manifest.push(
    `${today.ymd} ${today.dayShort} (today): ${todayJournals.length ? count('journal', todayJournals.length) : colors.yellow('no journal')}`,
  )

  return { sections, manifest }
}

export function formatPlanContext(context: PlanContext): string {
  if (!context.sections.length) return '(no notebook context available)'
  return formatSections(context.sections)
}
