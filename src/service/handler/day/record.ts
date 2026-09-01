/**
 * The day's record — what summary:day reads before it writes, served as
 * data instead of prose. The gather and its reading order, the done rule,
 * and the archival predicate are all summary:day's; nothing here decides
 * anything new about what a day is.
 */

import * as path from 'node:path'
import gatherDayDocs from '#commands/all/summary/lib/gatherDayDocs.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import AboutMeDocument from '#shared/models/AboutMe/document/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import { isParticipant } from '#shared/models/Message/mod.ts'
import { readDay } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** One bullet from the day file: a plan, a promise, or a thing done. */
export interface DayItem {
  text: string
  done: boolean
  /** "Professional" / "Personal" when the section names one */
  category: string | null
  /** `HH:MM` when the item carries one (done items usually do) */
  time: string | null
  /** The document the item points at, when it is a link */
  link: { title: string; path: string } | null
  /** The exact list heading the item lives under — the write-back address */
  list: string
  /** The item exactly as stored, strike marks included — the write-back address */
  raw: string
}

/** A document filed under the day, as a row. */
export interface DayDocRow {
  title: string
  /** Relative to the notebook root */
  path: string
  /** The `when:` range with its date stripped, e.g. `11:00 - 11:45` */
  when: string | null
  summary: string | null
}

export interface MeetingRow extends DayDocRow {
  who: string | null
}

export interface MessageRow extends DayDocRow {
  from: string | null
  to: string | null
  medium: string | null
}

export interface DayRecord {
  mostImportant: DayItem[]
  commitments: DayItem[]
  todos: DayItem[]
  reminders: DayItem[]
  done: DayItem[]
  meetings: MeetingRow[]
  messages: {
    /** Threads the owner took part in */
    involved: MessageRow[]
    /** Threads saved for reference — filed material, not activity */
    archive: MessageRow[]
  }
  notes: DayDocRow[]
  journals: DayDocRow[]
  /** Files the gather could not read — counted, never dropped silently */
  skipped: number
}

export interface DayRecordInput {
  day: PlainDate
  timeDir: string
  dayDirPath: string
  markdownBaseDir: string
  /** The owner's names, for the archival predicate; empty means nothing is archival */
  ownerNames: string[]
}

/** The owner as about-me.md names them — the same identity summary:day uses. */
export async function loadOwnerNames(aboutMePath: string | undefined): Promise<string[]> {
  if (!aboutMePath) return []
  try {
    const me = AboutMeDocument.fromMarkdown(await readTextFile(aboutMePath))
    return [me.fullName, me.firstName]
  } catch {
    return []
  }
}

// --- the day file's bullets -----------------------------------------------------

const TIMED = /^(\d{1,2}:\d{2})\s*>?\s*(.*)$/
const LINK = /\[([^\]]+)\]\(([^)]+)\)/
const STRUCK = /^~~(.*)~~$/

function parseItem(raw: string, category: string | null, list: string): DayItem {
  const done = DayDocument.isItemDone(raw)
  let text = raw.replace(STRUCK, '$1')
  let time: string | null = null
  const timed = text.match(TIMED)
  if (timed) {
    time = timed[1]
    text = timed[2]
  }
  // The strike may wrap only what follows the time: `09:30 > ~~[t](p)~~`.
  text = text.replace(STRUCK, '$1').trim()
  const linked = text.match(LINK)
  const link = linked ? { title: linked[1], path: linked[2] } : null
  if (linked) text = text.replace(linked[0], linked[1]).trim()
  return { text, done, category, time, link, list, raw }
}

/**
 * A capture log — `HH:MM > Someone to #channel Slack -> [Title](actions/…)`,
 * or a routine's own record like `HH:MM > Notebook -> 2026-01-26 End` — is
 * the day file noting that something was filed or ran. The file itself is
 * listed as a meeting, a message, or a chat; the log line is not a thing
 * done. The arrow is the tell — but only inside Complete lists, where this
 * filter runs: a commitment may promise `… Slack -> weekly update`.
 */
function isCaptureLog(item: DayItem): boolean {
  return /\s->\s/.test(item.text) || (item.link?.path.startsWith('actions/') ?? false)
}

function categoryOf(heading: string): string | null {
  const word = heading.split(/\s+/)[0]
  return word === 'Professional' || word === 'Personal' ? word : null
}

// --- the filed documents ----------------------------------------------------------

const H1 = /^#\s+(.+?)\s*$/m

/** The document's own name: its heading first — a meeting's H1 is its name, its summary the gist. */
function titleOf(doc: Document, filePath: string): string {
  const heading = doc.markdown.match(H1)?.[1]
  if (heading) return heading.replace(/\*\*/g, '').trim()
  const title = doc.yaml['title']
  if (typeof title === 'string' && title.trim()) return title.trim()
  return path.basename(filePath, '.md')
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return value.map(String).join(', ') || null
  return null
}

/** `2026-01-27 11:00 - 11:45` → `11:00 - 11:45`; the day is already known. */
function timeOf(value: unknown): string | null {
  const when = text(value)
  return when ? when.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') || null : null
}

function rowOf(doc: Document, filePath: string, base: string): DayDocRow {
  return {
    title: titleOf(doc, filePath),
    path: path.relative(base, filePath),
    when: timeOf(doc.yaml['when']),
    summary: text(doc.yaml['summary']),
  }
}

/** `Focus: 2026-01-27 - Tue - 13:30` — a journal named by its file stamp, not by a person. */
const JOURNAL_STAMP = /^(.+?):\s*\d{4}-\d{2}-\d{2}(?:\s*-\s*[A-Za-z]+)?(?:\s*-\s*(\d{1,2}:\d{2}))?\s*$/

/** The stamp carries the time and the rest is noise: `Focus` at `13:30`. */
function journalRow(row: DayDocRow): DayDocRow {
  const stamped = row.title.match(JOURNAL_STAMP)
  if (!stamped) return row
  return { ...row, title: stamped[1].trim(), when: row.when ?? stamped[2] ?? null }
}

// --- the record --------------------------------------------------------------------

export async function buildDayRecord(input: DayRecordInput): Promise<DayRecord> {
  const record: DayRecord = {
    mostImportant: [],
    commitments: [],
    todos: [],
    reminders: [],
    done: [],
    meetings: [],
    messages: { involved: [], archive: [] },
    notes: [],
    journals: [],
    skipped: 0,
  }

  // The plan and its outcome: the day file's own lists, by heading.
  try {
    const dayDoc = await readDay(input.day, input.timeDir)
    for (const list of dayDoc.lists) {
      const heading = list.title.trim()
      const category = categoryOf(heading)
      // A bare `-` is an empty slot a template or sweep left behind, not an item.
      const items = list.items
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => parseItem(raw, category, heading))
      if (/^most important$/i.test(heading)) record.mostImportant.push(...items)
      else if (/commitments$/i.test(heading)) record.commitments.push(...items)
      else if (/(todos|incomplete)$/i.test(heading)) record.todos.push(...items)
      else if (/^reminders$/i.test(heading)) record.reminders.push(...items)
      else if (/(?<!in)complete$/i.test(heading)) record.done.push(...items.filter((item) => !isCaptureLog(item)))
    }
  } catch {
    // No day file yet — a day that hasn't started has no plan to show.
  }

  // The evidence: everything filed under the day, in reading order.
  const { docs, skipped } = await gatherDayDocs(input.dayDirPath)
  record.skipped = skipped.tiny.length + skipped.yamlError.length + skipped.unreadable.length
  for (const entry of docs) {
    const row = rowOf(entry.doc, entry.path, input.markdownBaseDir)
    if (entry.kind === 'journal') record.journals.push(journalRow(row))
    else if (entry.path.includes('/actions/meetings/')) {
      record.meetings.push({ ...row, who: text(entry.doc.yaml['who']) })
    } else if (entry.path.includes('/actions/messages/')) {
      const message: MessageRow = {
        ...row,
        from: text(entry.doc.yaml['from']),
        to: text(entry.doc.yaml['to']),
        medium: text(entry.doc.yaml['medium']),
      }
      if (isParticipant(entry.doc, input.ownerNames)) record.messages.involved.push(message)
      else record.messages.archive.push(message)
    } else if (entry.path.includes('/actions/notes/')) record.notes.push(row)
  }

  return record
}
