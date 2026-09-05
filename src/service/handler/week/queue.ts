/**
 * What is already waiting for a week that has no plan yet — read from the
 * standing files at the top of time/, and written back to them the way
 * the commands do.
 *
 * - `next-professional.md` / `next-personal.md`: `## Week-Next` is the
 *   queue week:plan appends deferrals to and reads back when it drafts;
 *   `## Next` is the person's own backlog; `## Content` (personal) holds
 *   links. An item added here lands in Week-Next through the same helper
 *   week:plan uses, stamped with the week that pushed it.
 * - `schedule-professional.md` / `schedule-personal.md`: `## YYYY-MM-DD`
 *   lists; day:schedule:update pulls the day's list into the day file when
 *   that day starts. An item added with a day lands under that date, the
 *   way day:todo:add files a to-do for a day with no file yet.
 *
 * Removing a line is the person's hand: the bullet leaves; a list left
 * empty leaves with it, so a dated heading never stands over nothing.
 */

import * as path from 'node:path'
import { appendWeekNext } from '#commands/all/week/lib/weekNext.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import type { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

export const QUEUE_FILES = ['next-professional.md', 'next-personal.md'] as const
export const SCHEDULE_FILES = ['schedule-professional.md', 'schedule-personal.md'] as const
export type QueueFile = (typeof QUEUE_FILES)[number]
export type ScheduleFile = (typeof SCHEDULE_FILES)[number]
export type Category = 'Professional' | 'Personal'

export const WEEK_NEXT = 'Week-Next'
const NEXT = 'Next'
const CONTENT = 'Content'

export interface QueueItem {
  text: string
  /** `W36` — the week that pushed it, when the line carries the stamp */
  from: string | null
  /** The bullet exactly as written — the write-back address */
  raw: string
  file: QueueFile
}

export interface NextItem {
  text: string
  link: string | null
  raw: string
  file: QueueFile
  /** The heading the item sits under: Next, Content */
  list: string
}

export interface ScheduledItem {
  text: string
  /** `HH:MM` when the item is a timed one — it lands as a commitment */
  time: string | null
  category: Category
  raw: string
  file: ScheduleFile
}

export interface ScheduledGroup {
  /** `YYYY-MM-DD` */
  date: string
  items: ScheduledItem[]
}

export interface WeekQueue {
  weekNext: { professional: QueueItem[]; personal: QueueItem[] }
  scheduled: {
    /** Dates inside the week */
    inWeek: ScheduledGroup[]
    /** Dates after today that are not the week's */
    later: ScheduledGroup[]
    /** Dates that came and went without the day starting — never landed */
    past: ScheduledGroup[]
  }
  next: { professional: NextItem[]; personal: NextItem[]; content: NextItem[] }
}

export function isQueueFile(name: unknown): name is QueueFile {
  return typeof name === 'string' && (QUEUE_FILES as readonly string[]).includes(name)
}

export function isScheduleFile(name: unknown): name is ScheduleFile {
  return typeof name === 'string' && (SCHEDULE_FILES as readonly string[]).includes(name)
}

export function queueFileOf(category: Category): QueueFile {
  return category === 'Personal' ? 'next-personal.md' : 'next-professional.md'
}

export function scheduleFileOf(category: Category): ScheduleFile {
  return category === 'Personal' ? 'schedule-personal.md' : 'schedule-professional.md'
}

function categoryOf(file: QueueFile | ScheduleFile): Category {
  return file.endsWith('personal.md') ? 'Personal' : 'Professional'
}

// --- the files, by line ---------------------------------------------------------------

const H2 = /^##\s+(.+?)\s*$/
/** A top-level bullet; indented lines belong to the item above */
const BULLET = /^-\s+(.*\S)\s*$/
const PUSHED = /\s*\(pushed\s+(\d{4}-)?(W\d{2})\)\s*$/
const MD_LINK = /^\[([^\]]+)\]\((\S+)\)\s*$/
const BARE_URL = /^https?:\/\/\S+$/
const TIMED = /^(\d{1,2}:\d{2})\s*>\s*(.*)$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

interface Section {
  title: string
  heading: number
  bullets: { line: number; text: string }[]
}

function sectionsOf(lines: string[]): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  lines.forEach((line, i) => {
    const heading = line.match(H2)
    if (heading) {
      current = { title: heading[1], heading: i, bullets: [] }
      sections.push(current)
      return
    }
    const bullet = line.match(BULLET)
    if (bullet && current) current.bullets.push({ line: i, text: bullet[1] })
  })
  return sections
}

async function readLines(file: string): Promise<string[] | null> {
  if (!(await exists(file))) return null
  return (await readTextFile(file)).split('\n')
}

function queueItem(text: string, file: QueueFile): QueueItem {
  const pushed = text.match(PUSHED)
  return { text: (pushed ? text.slice(0, pushed.index) : text).trim(), from: pushed?.[2] ?? null, raw: text, file }
}

function nextItem(text: string, file: QueueFile, list: string): NextItem {
  const md = text.match(MD_LINK)
  if (md) return { text: md[1], link: md[2], raw: text, file, list }
  if (BARE_URL.test(text)) return { text, link: text, raw: text, file, list }
  return { text, link: null, raw: text, file, list }
}

function scheduledItem(text: string, file: ScheduleFile): ScheduledItem {
  const timed = text.match(TIMED)
  return {
    text: (timed ? timed[2] : text).trim(),
    time: timed?.[1] ?? null,
    category: categoryOf(file),
    raw: text,
    file,
  }
}

/** Everything waiting for the week: the queue, the dated items, the backlog. */
export async function readWeekQueue(timeDir: string, week: Week, today: PlainDate): Promise<WeekQueue> {
  const queue: WeekQueue = {
    weekNext: { professional: [], personal: [] },
    scheduled: { inWeek: [], later: [], past: [] },
    next: { professional: [], personal: [], content: [] },
  }

  for (const file of QUEUE_FILES) {
    const lines = await readLines(path.join(timeDir, file))
    if (!lines) continue
    const side = categoryOf(file) === 'Personal' ? 'personal' : 'professional'
    for (const section of sectionsOf(lines)) {
      if (section.title === WEEK_NEXT) {
        queue.weekNext[side].push(...section.bullets.map((b) => queueItem(b.text, file)))
      } else if (section.title === NEXT) {
        queue.next[side].push(...section.bullets.map((b) => nextItem(b.text, file, NEXT)))
      } else if (section.title === CONTENT) {
        queue.next.content.push(...section.bullets.map((b) => nextItem(b.text, file, CONTENT)))
      }
    }
  }

  const groups = new Map<string, ScheduledItem[]>()
  for (const file of SCHEDULE_FILES) {
    const lines = await readLines(path.join(timeDir, file))
    if (!lines) continue
    for (const section of sectionsOf(lines)) {
      if (!YMD.test(section.title)) continue
      const items = groups.get(section.title) ?? []
      items.push(...section.bullets.map((b) => scheduledItem(b.text, file)))
      groups.set(section.title, items)
    }
  }
  for (const date of [...groups.keys()].sort()) {
    const group = { date, items: groups.get(date) ?? [] }
    if (date < today.ymd) queue.scheduled.past.push(group)
    else if (date >= week.start.ymd && date <= week.end.ymd) queue.scheduled.inWeek.push(group)
    else queue.scheduled.later.push(group)
  }

  return queue
}

// --- writes -----------------------------------------------------------------------------

/** A line for the queue: `## Week-Next` of the category's next file, stamped with the pushing week. */
export async function addQueueItem(timeDir: string, category: Category, text: string, weekId: string): Promise<void> {
  const file = path.join(timeDir, queueFileOf(category))
  const existing = (await exists(file)) ? await readTextFile(file) : `---\n---\n\n# Next Actions ${category}\n`
  await writeTextFile(file, appendWeekNext(existing, [text.trim()], weekId))
}

/** A line for a day: under `## YYYY-MM-DD` in the category's schedule file, the list made in date order when missing. */
export async function addScheduledItem(timeDir: string, category: Category, ymd: string, text: string): Promise<void> {
  const file = path.join(timeDir, scheduleFileOf(category))
  const contents = (await exists(file)) ? await readTextFile(file) : `---\n---\n\n# ${category} Todos\n`
  const doc = ListDocument.fromMarkdown(contents)
  let withList = doc
  if (doc.findListIndex((list) => list.title === ymd) < 0) {
    const insertAt = doc.findListIndex((list) => list.title > ymd)
    withList = doc.insertList(insertAt < 0 ? doc.lists.length : insertAt, new ItemList(ymd))
  }
  await writeTextFile(file, withList.addItem(ymd, text.trim()).toMarkdown())
}

export type LineEdit = 'written' | 'missing'

/** The bullet leaves; a list it leaves empty leaves with it, blank lines and all. */
function removeBullet(lines: string[], list: string, raw: string): string[] | null {
  const section = sectionsOf(lines).find((s) => s.title === list.trim())
  if (!section) return null
  const bullet = section.bullets.find((b) => b.text === raw.trim())
  if (!bullet) return null
  const next = [...lines]
  if (section.bullets.length > 1) {
    next.splice(bullet.line, 1)
    return next
  }
  // The heading, the bullet, and the blank lines between and after — up to the next heading or the end.
  let end = bullet.line + 1
  while (end < next.length && next[end].trim() === '') end++
  let start = section.heading
  while (start > 0 && next[start - 1].trim() === '') start--
  next.splice(start, end - start, '')
  return next
}

/** Take one line out of a next or schedule file, by its heading and text. */
export async function removeItem(
  timeDir: string,
  file: QueueFile | ScheduleFile,
  list: string,
  raw: string,
): Promise<LineEdit> {
  const lines = await readLines(path.join(timeDir, file))
  if (!lines) return 'missing'
  const next = removeBullet(lines, list, raw)
  if (!next) return 'missing'
  await writeTextFile(path.join(timeDir, file), next.join('\n'))
  return 'written'
}

/** A backlog line moves into the queue: out of its list, into `## Week-Next` of the same file. */
export async function promoteItem(
  timeDir: string,
  file: QueueFile,
  list: string,
  raw: string,
  weekId: string,
): Promise<LineEdit> {
  const lines = await readLines(path.join(timeDir, file))
  if (!lines) return 'missing'
  const without = removeBullet(lines, list, raw)
  if (!without) return 'missing'
  await writeTextFile(path.join(timeDir, file), appendWeekNext(without.join('\n'), [raw.trim()], weekId))
  return 'written'
}
