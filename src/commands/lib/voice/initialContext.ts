/** A bounded, read-only notebook snapshot for voice. No model call at startup. */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type * as ConfigModule from '#shared/config.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { activeGoalsDir } from '#shared/models/Goal/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { loadMemories, type MemoryEntry } from '#shared/models/Memory/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import weekDir from '#shared/nbfs/weekDir.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { loadVoiceEntities, type VoiceEntities } from './contextEntities.ts'
import type { VoiceClock } from './sessionConfig.ts'

type ContextConfig = Pick<
  typeof ConfigModule,
  | 'DIR_BASE'
  | 'DIR_TIME'
  | 'DIR_AI_MEMORY'
  | 'DIR_GOALS'
  | 'FILE_ABOUT_ME'
  | 'FILE_GOALS_PERSONAL'
  | 'FILE_GOALS_PROFESSIONAL'
  | 'PORT_SERVER'
>
interface RecordExcerpt {
  source: string
  body: string
}
interface ContextReaders {
  read: (file: string) => Promise<string>
  /** File names in a folder; a missing folder lists nothing */
  list: (directory: string) => Promise<string[]>
  memories: (directory: string) => Promise<MemoryEntry[]>
  entities: typeof loadVoiceEntities
}

// Independent budgets keep a long day or profile from evicting preferences/goals.
// The sum is about 40k characters, plus headings/coverage.
const BUDGETS = {
  Profile: 3000,
  Preferences: 4000,
  'Vocabulary and lessons': 2500,
  'Other remembered context': 1500,
  Goals: 4500,
  'Current week': 3500,
  Today: 6000,
  'Recent days': 5000,
  People: 4000,
  'Open projects': 3000,
  'Pending decisions': 3000,
} as const

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n[Excerpt truncated; look up the source for more.]'
  const head = text.slice(0, Math.max(0, limit - marker.length))
  const lineEnd = head.lastIndexOf('\n')
  return (lineEnd > head.length / 2 ? head.slice(0, lineEnd) : head) + marker
}

function clean(body: string): string {
  // Bound parsing too: huge source files must not delay opening a call.
  const doc = Document.fromMarkdown(body.slice(0, 32_000))
    .stripHtmlComments()
    .filterSections((heading) => !heading.text.toLowerCase().includes('transcript'))
  const cleaned = doc.toMarkdown({ yaml: Object.keys(doc.yaml).length > 0 }).trim()
  // Keep this outside the parsed text: a truncated transcript section may
  // otherwise swallow the notice while also hiding later useful sections.
  return cleaned + (body.length > 32_000 ? '\n[Source truncated before parsing; later content omitted.]' : '')
}

function section(title: keyof typeof BUDGETS, records: RecordExcerpt[], baseDir: string): string {
  const limit = BUDGETS[title]
  const parts: string[] = []
  let remaining = limit - 100 // reserve a coverage note
  let omitted = 0
  // A single oversized record cannot crowd every other source out of its section.
  // Keep an excerpt useful even when a section contains hundreds of memories;
  // dividing to less than a source label would otherwise omit every record.
  const perRecord = Math.max(300, Math.floor(remaining / Math.max(1, records.length)))
  for (const record of records) {
    const source = path.isAbsolute(record.source) ? path.relative(baseDir, record.source) : record.source
    const label = `Source: ${excerpt(source, 300)}\n`
    const available = (title === 'Preferences' ? remaining : Math.min(perRecord, remaining)) - label.length - 2
    if (available < 60) {
      omitted++
      continue
    }
    const body = clean(record.body)
    if (!body) continue
    // Preferences are complete statements; never silently ship half an instruction.
    if (title === 'Preferences' && (body.length > available || record.body.length > 32_000)) {
      omitted++
      continue
    }
    const rendered = `${label}${excerpt(body, available)}`
    parts.push(rendered)
    remaining -= rendered.length + 2
  }
  if (omitted) parts.push(`[${omitted} records omitted by the ${title.toLowerCase()} budget.]`)
  return `### ${title}\n\n${parts.join('\n\n') || '[No records loaded for this section.]'}`
}

export interface VoiceSources {
  profile?: RecordExcerpt
  goals: RecordExcerpt[]
  week?: RecordExcerpt
  day?: RecordExcerpt
  recent: RecordExcerpt[]
  memories: MemoryEntry[]
  entities: VoiceEntities
  unavailable: string[]
  missing: string[]
  recentDates: PlainDate[]
}

/** The reads a call starts with, once: the snapshot for the backend and the speaking model's page both come from them. */
export async function loadVoiceSources(
  config: ContextConfig,
  clock: Pick<VoiceClock, 'notebookDate' | 'notebookTime' | 'notebookTimezone'>,
  readers: Partial<ContextReaders> = {},
): Promise<VoiceSources> {
  const read = readers.read ?? readTextFile
  const unavailable: string[] = []
  const missing: string[] = []
  const list = readers.list ?? ((directory: string) => readdir(directory).catch(() => [] as string[]))
  /** An optional source is one the notebook may rightly not have; its absence is not reported. */
  const readRecord = async (file: string, optional = false): Promise<RecordExcerpt | undefined> => {
    try {
      const body = await read(file)
      if (body.trim()) return { source: file, body }
      if (!optional) missing.push(path.relative(config.DIR_BASE, file))
      return undefined
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        unavailable.push(`Unreadable source: ${path.relative(config.DIR_BASE, file)}`)
      } else if (!optional) {
        missing.push(path.relative(config.DIR_BASE, file))
      }
      return undefined
    }
  }
  // One goal per file. An older notebook keeps whole-category files instead,
  // which are only expected when it has none of the new ones.
  const goalsDir = activeGoalsDir(config.DIR_GOALS)
  const goalFiles = (await list(goalsDir))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => path.join(goalsDir, name))
  const split = goalFiles.length > 0
  const today = PlainDate.from(clock.notebookDate)
  const recentDates = Array.from({ length: 6 }, (_, i) => today.addDays(-i - 1))
  const [profile, goals, week, day, recent, memories, entities] = await Promise.all([
    readRecord(config.FILE_ABOUT_ME),
    Promise.all([
      ...goalFiles.map((file) => readRecord(file)),
      readRecord(config.FILE_GOALS_PERSONAL, split),
      readRecord(config.FILE_GOALS_PROFESSIONAL, split),
    ]),
    readRecord(path.join(config.DIR_TIME, weekDir(today), 'week.md')),
    readRecord(path.join(config.DIR_TIME, dayFile(today))),
    Promise.all(
      recentDates.map(async (date) => {
        const summary = await readRecord(path.join(config.DIR_TIME, dayDir(date), 'summary.md'))
        return summary ?? readRecord(path.join(config.DIR_TIME, dayFile(date)))
      }),
    ),
    (readers.memories ?? loadMemories)(config.DIR_AI_MEMORY).catch(() => {
      unavailable.push('Memory store unavailable.')
      return []
    }),
    (readers.entities ?? loadVoiceEntities)(config.PORT_SERVER),
  ])
  const present = (items: (RecordExcerpt | undefined)[]): RecordExcerpt[] => items.filter((item) => item !== undefined)
  return {
    profile,
    goals: present(goals),
    week,
    day,
    recent: present(recent),
    memories,
    entities,
    unavailable,
    missing,
    recentDates,
  }
}

/** The backend's bounded snapshot, rendered from the call's sources. */
export function renderVoiceSnapshot(
  sources: VoiceSources,
  config: Pick<ContextConfig, 'DIR_BASE'>,
  clock: Pick<VoiceClock, 'notebookDate' | 'notebookTime' | 'notebookTimezone'>,
): string {
  const { memories, entities, unavailable, missing, recentDates } = sources
  const present = (items: (RecordExcerpt | undefined)[]): RecordExcerpt[] => items.filter((item) => item !== undefined)
  const memoryRecords = (kinds: MemoryEntry['kind'][]): RecordExcerpt[] =>
    memories
      .filter((memory) => kinds.includes(memory.kind))
      .map((memory) => ({
        source: memory.path,
        body: `Memory kind: ${memory.kind ?? 'unclassified'}; last confirmed/updated: ${memory.freshness ?? 'unknown'}\n${memory.body}`,
      }))
  const sections: Record<keyof typeof BUDGETS, RecordExcerpt[]> = {
    Profile: present([sources.profile]),
    Preferences: memoryRecords(['preference']),
    'Vocabulary and lessons': memoryRecords(['glossary', 'lesson']),
    'Other remembered context': memoryRecords(['thread', 'observation', undefined]),
    Goals: sources.goals,
    'Current week': present([sources.week]),
    Today: present([sources.day]),
    'Recent days': sources.recent,
    People: entities.people,
    'Open projects': entities.projects,
    'Pending decisions': entities.decisions,
  }
  const coverage = [
    `Notebook snapshot at ${clock.notebookDate} ${clock.notebookTime} (${clock.notebookTimezone}).`,
    `Partial excerpts, not a complete notebook search. Source paths and dates identify records, not proof of when events happened.`,
    `Task mentions and unchecked items describe recorded plans, not verified unfinished work. Summaries may lag completion and excerpts may omit completion records. No live mailbox or sent-message state is loaded in this snapshot.`,
    `Recent days cover ${recentDates.at(-1)!.ymd} through ${recentDates[0].ymd}: existing daily summaries, otherwise day records. Raw conversations and transcript sections are excluded.`,
    `Empty sections mean no records loaded, not that no such facts exist. Missing files and budget omissions require a lookup when relevant. Notebook records take precedence over conflicting remembered context; current user corrections take precedence over older records.`,
    ...entities.notes,
    ...entities.unavailable,
    ...[...unavailable].sort(),
    ...(missing.length ? [`Local sources missing or empty: ${[...missing].sort().join(', ')}.`] : []),
  ].join('\n')
  return `${coverage}\n\n${(Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]).map((key) => section(key, sections[key], config.DIR_BASE)).join('\n\n')}`
}

/** Browser call setup gathers this once, alongside calendar/tool discovery. */
export async function loadVoiceInitialContext(
  config: ContextConfig,
  clock: Pick<VoiceClock, 'notebookDate' | 'notebookTime' | 'notebookTimezone'>,
  readers: Partial<ContextReaders> = {},
): Promise<string> {
  return renderVoiceSnapshot(await loadVoiceSources(config, clock, readers), config, clock)
}
