/**
 * Direct-path readers for assembling AI context from the notebook.
 *
 * Shared by the gathers that feed drafting/question prompts (week:plan,
 * journal:new --ai). These read exactly the named files — no store build,
 * no query, no scoring. Missing or unreadable files are skipped silently:
 * a sparse notebook just yields fewer sections.
 */
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_DECISIONS, DIR_GOALS, DIR_TIME } from '#config'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import stripHtmlComments from '#shared/models/Markdown/Document/_stripHtmlComments.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** Most-important files live under a day's most-important/ directory as
 * MI1.md, MI2.md, … — optionally suffixed with a summary slug (MI2_Ship-Docs.md). */
export const MI_FILE = /^MI\d+(?:[_-].*)?\.md$/i

/** One titled block of assembled context. */
export interface ContextSection {
  title: string
  body: string
}

/** A notebook file read for context: name is the basename, path is absolute. */
export interface ContextFile {
  name: string
  path: string
  body: string
}

export async function tryRead(filePath: string): Promise<string | undefined> {
  try {
    return await readTextFile(filePath)
  } catch {
    return undefined
  }
}

export async function tryList(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

async function readMatching(dir: string, match: (name: string) => boolean): Promise<ContextFile[]> {
  const files: ContextFile[] = []
  for (const name of (await tryList(dir)).filter(match)) {
    const filePath = path.join(dir, name)
    const body = await tryRead(filePath)
    if (body !== undefined) files.push({ name, path: filePath, body })
  }
  return files
}

/** Every goal document: goals/*.md. */
export async function readGoals(): Promise<ContextFile[]> {
  return readMatching(DIR_GOALS, (f) => f.endsWith('.md'))
}

/** Standing planning files at the top of time/: commitments.md, next-*.md, schedule-*.md. */
export const PLANNING_FILE = /^(commitments|next-|schedule-).*\.md$/

/** The standing planning files — the deferred/scheduled backlog that outlives any one week. */
export async function readPlanningFiles(): Promise<ContextFile[]> {
  return readMatching(DIR_TIME, (f) => PLANNING_FILE.test(f))
}

/** A day's journal entries: time/<day>/journal/*.md. */
export async function readDayJournals(day: PlainDate): Promise<ContextFile[]> {
  return readMatching(path.join(DIR_TIME, dayDir(day), 'journal'), (f) => f.endsWith('.md'))
}

/** A day's most-important files: time/<day>/most-important/MI*.md. */
export async function readDayMostImportant(day: PlainDate): Promise<ContextFile[]> {
  return readMatching(path.join(DIR_TIME, dayDir(day), 'most-important'), (f) => MI_FILE.test(f))
}

/** A day's AI chats: time/<day>/actions/ai-chats/*.md. The conversation rides;
 * machine HTML comments (e.g. the CONTEXT-LOG turn record) are stripped. */
export async function readDayChats(day: PlainDate): Promise<ContextFile[]> {
  const files = await readMatching(path.join(DIR_TIME, dayDir(day), 'actions', 'ai-chats'), (f) => f.endsWith('.md'))
  return files.map((f) => ({ ...f, body: stripHtmlComments(f.body) }))
}

/** Pending decisions: every .md under a decisions/<year>/pending/ directory. */
export async function readPendingDecisions(): Promise<ContextFile[]> {
  if (!(await exists(DIR_DECISIONS))) return []
  const pendingSegment = `${path.sep}pending${path.sep}`
  const found: string[] = []
  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.path.includes(pendingSegment)) found.push(entry.path)
  }
  found.sort()
  const files: ContextFile[] = []
  for (const filePath of found) {
    const body = await tryRead(filePath)
    if (body !== undefined) files.push({ name: path.basename(filePath), path: filePath, body })
  }
  return files
}

/**
 * A day's best available narration: summary.md when it has content, else
 * day.md. The summary tells what the day amounted to; the day file is the
 * raw ledger of commitments, todos, and completions (captures record every
 * message there one line each). Returns undefined when neither exists.
 */
export async function readDayNarration(
  day: PlainDate,
): Promise<(ContextFile & { kind: 'summary' | 'day' }) | undefined> {
  const dd = path.join(DIR_TIME, dayDir(day))
  const summaryPath = path.join(dd, 'summary.md')
  const summary = await tryRead(summaryPath)
  if (summary?.trim()) return { kind: 'summary', name: 'summary.md', path: summaryPath, body: summary }
  const dayPath = path.join(dd, 'day.md')
  const dayBody = await tryRead(dayPath)
  if (dayBody === undefined) return undefined
  return { kind: 'day', name: 'day.md', path: dayPath, body: dayBody }
}

/** Render sections in the `<<< title >>>` block format the gathers share. */
export function formatSections(sections: ContextSection[]): string {
  return sections.map((s) => `<<< ${s.title} >>>\n${s.body}`).join('\n\n')
}
