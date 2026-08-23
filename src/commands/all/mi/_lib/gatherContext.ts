/**
 * Context for mi:new --ai suggestions.
 *
 * One rule, no scoring — the MI twin of journal:new's gather:
 *
 * PINNED (always included):
 *   - goals, pending decisions, the current week's week.md (the plan)
 *   - standing planning files (time/commitments.md, next-*.md, schedule-*.md) —
 *     the deferred/scheduled backlog an MI often should come from
 * PER DAY, last 7 days incl. today:
 *   - most-important files (what was committed, and whether it completed)
 *   - journal entries (stated intent, distinct from what happened)
 *   - AI chats (journal-like thinking out loud — what's on the user's mind;
 *     machine CONTEXT-LOG comments stripped, conversation kept)
 *   - summary.md if it has content, else day.md (today always rides as
 *     day.md — the schedule/reminder/todo ledger the MI must fit around)
 *
 * Message, meeting, and library documents never ride raw: a summarized
 * day narrates them, and day.md's ledger already records captures and
 * meetings one line each. Health tracking and streaks are deliberately
 * absent — routine maintenance is not MI material, and anything urgent
 * surfaces through journals and day files. Deterministic direct-path reads —
 * no store build, no query, no scorer. Tokens are estimated only to warn on
 * runaway size.
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
  readPlanningFiles,
  tryRead,
} from '#commands/lib/notebookContext.ts'
import { DIR_BASE, DIR_TIME } from '#config'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { parseWithError } from '#shared/yaml/mod.ts'
import { type PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

/** Trailing window (incl. today) whose journals, chats, MIs, and narration ride. */
const LOOKBACK_DAYS = 7
/** Estimated size above which mi:new warns — the gather itself never caps. */
export const CONTEXT_TOKENS_TRIPWIRE = 100_000

export interface MIContext {
  /** Assembled context markdown, one `<<< titled >>>` section per document */
  contextMarkdown: string
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
  /** Summaries of MIs already committed today — the prompt lists these as
   * do-not-resuggest, so a rerun proposes what comes next. */
  todayMIs: string[]
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

/** The `summary:` frontmatter of a committed MI, if it carries one. */
function miSummary(body: string): string | undefined {
  const fence = body.match(/^---\n([\s\S]*?)\n---/)
  if (!fence) return undefined
  const { data } = parseWithError(fence[1]) as { data: Record<string, unknown> }
  const summary = data['summary']
  return typeof summary === 'string' && summary.trim() ? summary.trim() : undefined
}

export async function gatherContext(today: PlainDate, time?: string): Promise<MIContext> {
  const sections: ContextSection[] = []
  const add = (title: string, body: string | undefined) => {
    if (body?.trim()) sections.push({ title, body: body.trim() })
  }

  // Pinned: the anchors every run sees, independent of recency.
  for (const goal of await readGoals()) add(relToBase(goal.path), goal.body)
  for (const decision of await readPendingDecisions()) add(relToBase(decision.path), decision.body)
  for (const planning of await readPlanningFiles()) add(relToBase(planning.path), planning.body)

  const week = Week.of(today)
  add(`This week's plan (${week.toString()})`, await tryRead(path.join(DIR_TIME, weekDir(week.startInYear), 'week.md')))

  // Days, oldest first, so the freshest material sits nearest the ask.
  const todayMIs: string[] = []
  for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
    const day = today.addDays(-i)
    const label = i === 0 ? `${day.ymd} ${day.dayShort} (today)` : `${day.ymd} ${day.dayShort}`

    for (const file of await readDayJournals(day)) add(`${label} — journal/${file.name}`, file.body)
    for (const file of await readDayChats(day)) add(`${label} — chat: ${file.name}`, file.body)
    for (const file of await readDayMostImportant(day)) {
      add(`${label} — most important: ${file.name}`, file.body)
      if (i === 0) todayMIs.push(miSummary(file.body) ?? file.name)
    }
    const narration = await readDayNarration(day)
    if (narration) add(`${label} — ${narration.kind === 'summary' ? 'summary' : 'day.md (no summary)'}`, narration.body)
  }

  const contextMarkdown = formatSections(sections)

  return {
    contextMarkdown,
    today: {
      date: today.ymd,
      dayOfWeek: today.dayLong,
      ...(time ? { time, timeOfDay: getTimeOfDay(time) } : {}),
    },
    documentCount: sections.length,
    totalTokens: estimateTokens(contextMarkdown),
    todayMIs,
  }
}
