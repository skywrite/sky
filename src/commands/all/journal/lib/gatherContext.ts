/**
 * Context for journal:new --ai question generation.
 *
 * One rule, no scoring — the journal twin of week:plan's planContext:
 *
 * PINNED (always included):
 *   - goals, pending decisions, the current week's week.md, active streaks
 *   - health tracking lines (last 5 days)
 * PER DAY, last 7 days incl. today:
 *   - AI chats (the day's chats folder)
 *   - most-important files (n/MI*.md)
 *   - summary.md if it has content, else day.md
 * PER DAY, last 14 days incl. today:
 *   - journal entries (recurring themes + what was already asked)
 *
 * Message, meeting, and library documents never ride raw: a summarized
 * day narrates them, and day.md's ledger already records captures and
 * meetings one line each. Deterministic direct-path reads — no store build,
 * no query, no scorer. Tokens are estimated only to warn on runaway size.
 */
import * as path from 'node:path'
import {
  type ContextSection,
  formatSections,
  readDayChats,
  readDayJournals,
  readDayMostImportant,
  readDayNarration,
  readGoals,
  readPendingDecisions,
  tryRead,
} from '#commands/lib/notebookContext.ts'
import { DIR_BASE, DIR_TIME } from '#config'
import { loadStreaks } from '#lib/streaks/mod.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { type PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { gatherHealthData } from '../../summary/_health.ts'

/** Trailing window (incl. today) whose narration, most-important files, and AI chats ride. */
const NARRATION_DAYS = 7
/** Trailing window (incl. today) whose journal entries ride. */
const JOURNAL_DAYS = 14
/** Days of health tracking lines. */
const HEALTH_DAYS = 5
/** Estimated size above which journal:new warns — the gather itself never caps. */
export const CONTEXT_TOKENS_TRIPWIRE = 100_000

export interface JournalContext {
  /** Assembled context markdown, one `<<< titled >>>` section per document */
  contextMarkdown: string
  /** Absolute paths of all documents included in the context */
  paths: string[]
  today: {
    date: string
    dayOfWeek: string
    /** HH:MM time string (may have extended hours like "25:30") */
    time?: string
    /** "morning", "afternoon", or "evening" */
    timeOfDay?: string
  }
  documentCount: number
  /** Estimated tokens of the assembled context. */
  totalTokens: number
}

function getTimeOfDay(time: string): string {
  const hour = parseInt(time.split(':')[0], 10)
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function relToBase(filePath: string): string {
  return filePath.startsWith(DIR_BASE) ? filePath.slice(DIR_BASE.length + 1) : filePath
}

export async function gatherContext(today: PlainDate, time?: string): Promise<JournalContext> {
  const sections: ContextSection[] = []
  const paths: string[] = []
  const add = (title: string, file: { path: string; body: string } | undefined) => {
    if (file?.body.trim()) {
      sections.push({ title, body: file.body.trim() })
      paths.push(file.path)
    }
  }

  // Pinned: the anchors every run sees, independent of recency.
  for (const goal of await readGoals()) add(relToBase(goal.path), goal)
  for (const decision of await readPendingDecisions()) add(relToBase(decision.path), decision)

  const week = Week.of(today)
  const weekMdPath = path.join(DIR_TIME, weekDir(week.startInYear), 'week.md')
  add(`This week's plan (${week.toString()})`, { path: weekMdPath, body: (await tryRead(weekMdPath)) ?? '' })

  for (const streak of await loadStreaks('active')) {
    add(relToBase(streak.path), { path: streak.path, body: (await tryRead(streak.path)) ?? '' })
  }

  // Days, oldest first, so the freshest material sits nearest the questions.
  for (let i = JOURNAL_DAYS - 1; i >= 0; i--) {
    const day = today.addDays(-i)
    const label = i === 0 ? `${day.ymd} ${day.dayShort} (today)` : `${day.ymd} ${day.dayShort}`

    for (const file of await readDayJournals(day)) add(`${label} — journal/${file.name}`, file)
    if (i >= NARRATION_DAYS) continue

    for (const file of await readDayChats(day)) add(`${label} — chat: ${file.name}`, file)
    for (const file of await readDayMostImportant(day)) add(`${label} — most important: ${file.name}`, file)
    const narration = await readDayNarration(day)
    if (narration) add(`${label} — ${narration.kind === 'summary' ? 'summary' : 'day.md (no summary)'}`, narration)
  }

  let contextMarkdown = formatSections(sections)
  const healthLines = await gatherHealthLines(today, HEALTH_DAYS)
  if (healthLines) {
    const healthSection = `<<< Health Tracking (last ${HEALTH_DAYS} days) >>>\n${healthLines}`
    contextMarkdown = contextMarkdown ? `${contextMarkdown}\n\n${healthSection}` : healthSection
  }

  return {
    contextMarkdown,
    paths,
    today: {
      date: today.ymd,
      dayOfWeek: today.dayLong,
      ...(time ? { time, timeOfDay: getTimeOfDay(time) } : {}),
    },
    documentCount: paths.length,
    totalTokens: estimateTokens(contextMarkdown),
  }
}

async function gatherHealthLines(today: PlainDate, days: number): Promise<string | null> {
  const lines: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = today.addDays(-i)
    const data = await gatherHealthData(day, DIR_TIME)
    const parts: string[] = []
    if (data.sleep) parts.push(`Sleep: ${data.sleep.range} (${data.sleep.duration} hrs)`)
    if (data.weight) parts.push(`Weight: ${data.weight} lbs`)
    if (data.strength) {
      const sessions = data.strength.map((s) => `${s.lbs} lbs${s.duration ? `, ${s.duration} mins` : ''}`).join('; ')
      parts.push(`Strength: ${sessions}`)
    }
    if (data.distance) {
      const sessions = data.distance.map((s) => `${s.miles} mi${s.duration ? `, ${s.duration} mins` : ''}`).join('; ')
      parts.push(`Distance: ${sessions}`)
    }
    if (data.work) parts.push(`Work: ${data.work.duration} hrs`)
    if (parts.length > 0) lines.push(`- **${day.ymd}**: ${parts.join(' | ')}`)
  }
  if (lines.length === 0) return null
  return lines.join('\n')
}
