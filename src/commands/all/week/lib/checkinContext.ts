import colors from 'picocolors'
import { gatherWeekHealthData, type WeekHealthCsv } from '#commands/all/summary/_health.ts'
import {
  type ContextSection,
  formatSections,
  readDayJournals,
  readDayMostImportant,
  readDayNarration,
  readGoals,
  readPlanningFiles,
} from '#commands/lib/notebookContext.ts'
import { DIR_TIME } from '#config'
import { PlainDate, type Week } from '#universal/dates/nbdt/mod.ts'

export interface CheckinContext {
  sections: ContextSection[]
  /** Day-keyed tracking CSVs for the week — measurable goals grade from rows. */
  healthCsvs: WeekHealthCsv[]
  /** One line per source consulted — printed by the command so the run shows
   * exactly what the grader saw. Same convention as week:plan's manifest. */
  manifest: string[]
}

/**
 * The days whose record feeds a checkin: the week's days through today
 * INCLUSIVE — today's partial record is evidence too (the morning journal
 * states intent, day.md shows what has landed so far). A completed week
 * contributes all seven.
 */
export function checkinDayRange(week: Week, today: PlainDate): PlainDate[] {
  return week.days.filter((day) => PlainDate.compare(day, today) <= 0)
}

/**
 * Best-effort gather of the grading evidence. Unlike summary:week's
 * summaries-only law, a checkin values freshness over provenance: a day
 * without a summary rides its raw day.md — mid-week, the newest days never
 * have summaries yet. Missing files contribute nothing; every source
 * consulted lands in the manifest.
 */
export async function gatherCheckinContext(week: Week, today: PlainDate): Promise<CheckinContext> {
  const sections: ContextSection[] = []
  const manifest: string[] = []
  const add = (title: string, body: string | undefined): boolean => {
    if (!body?.trim()) return false
    sections.push({ title, body: body.trim() })
    return true
  }
  const count = (name: string, n: number) => (n > 1 ? `${name} ×${n}` : name)

  const goalCount = (await readGoals()).filter((goal) => add(`goals/${goal.name}`, goal.body)).length
  const planning = (await readPlanningFiles()).filter((file) => add(`time/${file.name}`, file.body))
  manifest.push(`goals ×${goalCount} · time/: ${planning.map((f) => f.name).join(', ') || '(none)'}`)

  for (const day of checkinDayRange(week, today)) {
    const isToday = day.ymd === today.ymd
    const label = `${day.ymd} ${day.dayShort}${isToday ? ' (today)' : ''}`

    const journals = (await readDayJournals(day)).filter((file) => add(`${label} — journal/${file.name}`, file.body))
    const mi = (await readDayMostImportant(day)).filter((file) =>
      add(`${label} — most important: ${file.name}`, file.body),
    )

    const narration = await readDayNarration(day)
    let dayNote = colors.red('NO record')
    if (
      narration &&
      add(`${label} — ${narration.kind === 'summary' ? 'summary' : 'day.md (no summary)'}`, narration.body)
    ) {
      dayNote =
        narration.kind === 'summary'
          ? colors.green('summary ✓')
          : colors.yellow(isToday ? 'day.md (partial day)' : 'NO summary — day.md rode instead')
    }

    const parts = [dayNote]
    if (journals.length) parts.push(count('journal', journals.length))
    if (mi.length) parts.push(count('MI', mi.length))
    manifest.push(`${label}: ${parts.join(' · ')}`)
  }

  const healthCsvs = await gatherWeekHealthData(week.start, DIR_TIME)
  manifest.push(
    `_tracking/health: ${healthCsvs.length ? healthCsvs.map((h) => h.name).join(', ') : colors.yellow('(none)')}`,
  )

  return { sections, healthCsvs, manifest }
}

export function formatCheckinContext(context: CheckinContext): string {
  if (!context.sections.length) return '(no notebook context available)'
  return formatSections(context.sections)
}
