/**
 * The day's record — what summary:day reads before it writes, served as
 * data instead of prose. The gather and its reading order, the done rule,
 * and the archival predicate are all summary:day's; nothing here decides
 * anything new about what a day is.
 */

import * as path from 'node:path'
import { Lexer, type Token, type Tokens } from 'marked'
import gatherDayDocs from '#commands/all/summary/lib/gatherDayDocs.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import AboutMeDocument from '#shared/models/AboutMe/document/mod.ts'
import { parseMeetingEntry } from '#shared/models/Day/document/meetings.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import { isParticipant } from '#shared/models/Message/mod.ts'
import { ACTIONS_DIR, dayFile, isActionPath } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { editableRow } from './editingText.ts'
import { dayEnd } from './ended.ts'
import { planOrder } from './order.ts'
import { rowRevision } from './organizingText.ts'
import type { CommitmentOrder } from './organizingTypes.ts'
import { splitItemTime } from './planningTypes.ts'

/** One bullet from the day file: a plan, a promise, or a thing done. */
export interface DayItem {
  text: string
  done: boolean
  /** "Professional" / "Personal" when the section names one */
  category: string | null
  /** `HH:MM` when the item carries one (done items usually do) */
  time: string | null
  /** How long a Complete entry took, from `08:30(4h) > …` — absent when it does not say */
  minutes?: number
  /** The document the item points at, when it is a link */
  link: { title: string; path: string } | null
  /** The exact list heading the item lives under — the write-back address */
  list: string
  /** The item exactly as stored, strike marks included — the write-back address */
  raw: string
  occurrence?: number
  revision?: string
  workstream?: { id: string; activityId: string; kind: string; error?: string }
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
  minutes?: number
  inline?: boolean
}

export interface EventRow extends DayDocRow {
  who: string | null
  where: string | null
}

export interface MessageRow extends DayDocRow {
  from: string | null
  to: string | null
  medium: string | null
}

export interface VideoRow extends DayDocRow {
  from: string | null
  to: string | null
  medium: string | null
}

export interface DayRecord {
  /** `HH:MM` the day started; null for a day that never did, which has no end to record */
  started: string | null
  ended: boolean
  /** Recorded end in the day's timezone; null when open or the time cannot be read. */
  endedAt: string | null
  /** The end as the page reads it: `22:41`, `25:40` past midnight, or a date once it fell past the next noon */
  endedClock: string | null
  /** Ended with every planned item done — the file's `perfect: true` */
  perfect: boolean
  manualOrder?: string[]
  commitmentsOrder?: CommitmentOrder
  mostImportant: DayItem[]
  commitments: DayItem[]
  todos: DayItem[]
  reminders: DayItem[]
  done: DayItem[]
  meetings: MeetingRow[]
  events: EventRow[]
  videos: VideoRow[]
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

const STRUCK = /^~~(.*)~~$/

function firstItemLink(tokens: Token[]): Tokens.Link | null {
  for (const token of tokens) {
    if (token.type === 'link') return token as Tokens.Link
    if ('tokens' in token && Array.isArray(token.tokens)) {
      const link = firstItemLink(token.tokens)
      if (link) return link
    }
  }
  return null
}

function parseItem(raw: string, category: string | null, list: string): DayItem {
  // Attached notes stay in raw for file operations; only the first line is the task label.
  const head = raw.split(/\r?\n/)[0]
  const done = DayDocument.isItemDone(head)
  const { time, minutes, text: words } = splitItemTime(head.replace(STRUCK, '$1'), list)
  // The strike may wrap only what follows the time: `09:30 > ~~[t](p)~~`.
  let text = words.replace(STRUCK, '$1').trim()
  const linked = firstItemLink(Lexer.lexInline(text))
  const link = linked ? { title: linked.text, path: linked.href } : null
  if (linked) text = text.replace(linked.raw, linked.text).trim()
  // MI labels organize the notebook; the day view shows just the task.
  text = text.replace(/^MI\/\S+(?:\s*(?:->|→))?\s*/i, '')
  return { text, done, category, time, ...(minutes ? { minutes } : {}), link, list, raw }
}

/**
 * A capture log — `HH:MM > Someone to #channel Slack -> [Title](actions/…)`,
 * or a routine's own record like `HH:MM > Notebook -> 2026-01-26 End` — is
 * the day file noting that something was filed or ran. The file itself is
 * listed as a meeting, a message, or a chat; the log line is not a thing
 * done. Recognize meetings, action links, and known routine labels; a prose
 * arrow on its own must not hide a manually completed activity.
 */
function isCaptureLog(item: DayItem): boolean {
  return (
    parseMeetingEntry(item.raw) !== null ||
    (item.link?.path.startsWith(`${ACTIONS_DIR}/`) ?? false) ||
    /^(?:Notebook|(?:projects|streaks|ideas|decisions)\/.+?)\s+->\s/.test(item.text)
  )
}

function categoryOf(heading: string): string | null {
  const word = heading.split(/\s+/)[0]
  return word === 'Professional' || word === 'Personal' ? word : null
}

// --- the filed documents ----------------------------------------------------------

const H1 = /^#\s+(.+?)\s*$/m

/** The document's own name: its heading first — a meeting's H1 is its name, its summary the gist. */
export function titleOf(doc: Document, filePath: string): string {
  const heading = doc.markdown.match(H1)?.[1]
  if (heading) return heading.replace(/\*\*/g, '').trim()
  for (const title of [doc.yaml['title'], doc.yaml['what']]) {
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
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

function messageRow(row: DayDocRow, doc: Document, filePath: string): MessageRow {
  const medium = text(doc.yaml['medium'])
  const filename = path.basename(filePath, '.md')
  let title = row.summary ?? text(doc.yaml['subject']) ?? row.title
  if (title === filename || title.toLowerCase() === medium?.toLowerCase()) {
    // Older captures may have only a stamped medium_participants_summary filename.
    const parts = filename.replace(/^(?:\d{4}-\d{2}-\d{2}_\d{6}|\d{2}-\d{2})_/, '').split('_')
    const normalizeMedium = (value: string) => value.replace(/[-\s]+/g, '').toLowerCase()
    const name =
      medium && normalizeMedium(parts[0]) === normalizeMedium(medium) ? parts.slice(2).join(' ') : parts.join(' ')
    title = name.replace(/[-_]+/g, ' ').trim() || 'Conversation'
  }
  return {
    ...row,
    title,
    from: text(doc.yaml['from']),
    to: text(doc.yaml['to']),
    medium,
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
    started: null,
    ended: false,
    endedAt: null,
    endedClock: null,
    perfect: false,
    mostImportant: [],
    commitments: [],
    todos: [],
    reminders: [],
    done: [],
    meetings: [],
    events: [],
    videos: [],
    messages: { involved: [], archive: [] },
    notes: [],
    journals: [],
    skipped: 0,
  }

  // The plan and its outcome: the day file's own lists, by heading.
  try {
    const file = path.join(input.timeDir, dayFile(input.day))
    const content = await readTextFile(file)
    const dayDoc = DayDocument.fromMarkdown(content)
    Object.assign(record, planOrder(content))
    Object.assign(record, dayEnd(dayDoc))
    for (const meeting of dayDoc.meetings) {
      record.meetings.push({
        title: meeting.title,
        path: path.relative(
          input.markdownBaseDir,
          meeting.path ? path.resolve(input.dayDirPath, meeting.path) : path.join(input.timeDir, dayFile(input.day)),
        ),
        when: meeting.time,
        ...(meeting.minutes ? { minutes: meeting.minutes } : {}),
        who: meeting.who,
        summary: meeting.notes,
        inline: !meeting.path,
      })
    }
    for (const list of dayDoc.lists) {
      const heading = list.title.trim()
      const category = categoryOf(heading)
      // A bare `-` is an empty slot a template or sweep left behind, not an item.
      const occurrences = new Map<string, number>()
      const items = list.items
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => {
          const item = parseItem(raw, category, heading)
          const firstLine = raw.split(/\r?\n/)[0]
          const occurrence = occurrences.get(firstLine) ?? 0
          occurrences.set(firstLine, occurrence + 1)
          try {
            const row = editableRow(content, heading, raw, occurrence)
            item.occurrence = occurrence
            item.revision = rowRevision(content, file, heading, row.block, item.occurrence)
          } catch {
            /* Non-plan rows stay visible without a bulk mutation address. */
          }
          return item
        })
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
    else if (isActionPath('meeting', entry.path)) {
      const existing = record.meetings.findIndex((m) => !m.inline && m.path === row.path)
      const meeting = { ...row, who: text(entry.doc.yaml['who']) }
      if (existing >= 0)
        record.meetings[existing] = { ...meeting, when: meeting.when ?? record.meetings[existing].when }
      else record.meetings.push(meeting)
    } else if (isActionPath('event', entry.path)) {
      record.events.push({ ...row, who: text(entry.doc.yaml['who']), where: text(entry.doc.yaml['where']) })
    } else if (isActionPath('message', entry.path)) {
      const message = messageRow(row, entry.doc, entry.path)
      if (isParticipant(entry.doc, input.ownerNames)) record.messages.involved.push(message)
      else record.messages.archive.push(message)
    } else if (isActionPath('video', entry.path)) {
      record.videos.push({
        ...row,
        // Video files use the platform as their H1; the summary names the recording.
        title: row.summary ?? row.title,
        from: text(entry.doc.yaml['from']),
        to: text(entry.doc.yaml['to']),
        medium: text(entry.doc.yaml['medium']),
      })
    } else if (isActionPath('note', entry.path)) record.notes.push(row)
  }

  return record
}
