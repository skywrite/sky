/**
 * A note written on the day's page, `/<ymd>/notes/<name>`. Its first save files it the way
 * `notes:new` does: the markdown in the day's notes folder, named by its title, and a line in the
 * day's Complete list. Later saves go through the document API like any file's; these routes only
 * create a note, find one by name, and move its line between the categories.
 */

import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Hono, type MiddlewareHandler } from 'hono'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import { atomicWrite, hash, readOptional, withLock } from '#lib/outbox/files.ts'
import slugify from '#lib/string/slugify.ts'
import { exists } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { actionKindRel, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { stringify } from '#shared/yaml/stringify/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { readMarkdownContent } from '../markdown-preview/content.ts'
import isDay from './isDay.ts'
import { bodyOf } from './itemContext.ts'

export type NoteCategory = 'Professional' | 'Personal'

export interface NoteRoutesOptions {
  timeDir: string
  /** The notebook root the answers' paths are relative to, as the document API reads them */
  markdownBaseDir: string
  /** Where the day page keeps its planning lock; a temporary folder per notebook without one */
  stateDir?: string
  /** Where the lock every day writer shares lives, beside the workstreams' state */
  dayLockDir?: string
  /** The notebook clock: a note is written at its time, hours past 24 included */
  clock: () => ZonedDateTime | null
}

/** A note's content stays within what a person writes in one page. */
const MAX_NOTE_LENGTH = 1_000_000
/** `/<ymd>/notes/new` is the blank page, so no note may be named that. */
const BLANK_PAGE = 'new'

export function createNoteRoutes(options: NoteRoutesOptions): Hono {
  const app = new Hono()

  // The writes come from the Sky page, as JSON — the guard the day's item routes keep.
  const guard: MiddlewareHandler = async (c, next) => {
    if (c.req.method === 'GET') return next()
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ error: 'Open the day from the Sky app.' }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ error: 'Expected a JSON request.' }, 400)
    await next()
  }
  app.use('/:ymd/notes', guard)
  app.use('/:ymd/notes/*', guard)

  // The first save: the file, named by the title, and its line in the day.
  app.post('/:ymd/notes', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    const body = await bodyOf(c)
    const content = body?.content
    const category = categoryOf(body?.category)
    if (typeof content !== 'string' || !content.trim())
      return c.json({ error: 'The note is empty. Write a title or a line, and it saves.' }, 400)
    if (content.length > MAX_NOTE_LENGTH)
      return c.json({ error: 'This note is too long to save in one page. Split it into two notes.' }, 413)
    if (!category) return c.json({ error: 'Choose Professional or Personal for the note.' }, 400)

    const day = new PlainDate(ymd)
    const time = (options.clock() ?? new ZonedDateTime()).time
    const title = noteTitle(content)
    // Named like the notes `notes:new` files, not `YYYY-MM-DD_HHMMSS_…`: the note lives in its day's
    // folder, which already carries the date, beside the notes the command writes by summary.
    const writer = new DayDirFileWriter(day, options.timeDir)
    const relative = await writer.write(
      `${actionKindRel('note')}/${noteFileStem(title)}.md`,
      stampNote(content, title, time),
    )
    const file = path.join(writer.fullDir, relative)

    let problem: string | null = null
    try {
      await withDayLock(options, ymd, () =>
        writeDayItems(day, `${category} Complete`, dayLine(time, title, relative), { timeDir: options.timeDir }),
      )
    } catch (error) {
      problem = `The note is saved, but the day could not list it: ${(error as Error).message}`
    }
    const saved = await readMarkdownContent(file)
    return c.json(
      {
        path: path.relative(options.markdownBaseDir, file),
        slug: path.basename(relative, '.md'),
        content: saved.content,
        version: saved.version,
        category,
        problem,
      },
      201,
    )
  })

  // A note by its name: where it is, and which of the day's lists names it.
  app.get('/:ymd/notes/:slug', async (c) => {
    const ymd = c.req.param('ymd')
    const slug = c.req.param('slug')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    if (!isNoteName(slug)) return c.json({ error: 'That is not a note’s name.' }, 400)
    const day = new PlainDate(ymd)
    const file = noteFile(options, day, slug)
    if (!(await exists(file))) return c.json({ error: `There is no note called ${slug} on ${day.dayLong}.` }, 404)
    const content = (await readOptional(path.join(options.timeDir, dayFile(day)))) ?? ''
    return c.json({
      path: path.relative(options.markdownBaseDir, file),
      slug,
      category: noteLine(content, noteDayPath(slug))?.category ?? null,
    })
  })

  // Professional or Personal: the note's line moves to the other Complete list.
  app.put('/:ymd/notes/:slug/category', async (c) => {
    const ymd = c.req.param('ymd')
    const slug = c.req.param('slug')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    if (!isNoteName(slug)) return c.json({ error: 'That is not a note’s name.' }, 400)
    const category = categoryOf((await bodyOf(c))?.category)
    if (!category) return c.json({ error: 'Choose Professional or Personal for the note.' }, 400)
    const day = new PlainDate(ymd)
    const file = noteFile(options, day, slug)
    if (!(await exists(file))) return c.json({ error: `There is no note called ${slug} on ${day.dayLong}.` }, 404)
    const target = `${category} Complete`
    await withDayLock(options, ymd, async () => {
      const dayPath = path.join(options.timeDir, dayFile(day))
      const content = (await readOptional(dayPath)) ?? ''
      const line = noteLine(content, noteDayPath(slug))
      if (line?.list === target) return
      let raw = line?.raw
      if (line) {
        const removed = DayDocument.deleteItem(content, line.list, line.raw)
        if (removed.kind === 'written') await atomicWrite(dayPath, removed.content)
      } else {
        // A note the day never listed gets its line now, from its own title and time.
        const note = await readMarkdownContent(file)
        raw = dayLine(
          noteWhen(note.content) ?? (options.clock() ?? new ZonedDateTime()).time,
          noteTitle(note.content),
          noteDayPath(slug),
        )
      }
      await writeDayItems(day, target, raw!, { timeDir: options.timeDir })
    })
    return c.json({ category })
  })

  return app
}

function categoryOf(value: unknown): NoteCategory | null {
  return value === 'Professional' || value === 'Personal' ? value : null
}

/** A file name the routes can address: one segment, nothing hidden. */
function isNoteName(slug: string): boolean {
  return slug.length > 0 && slug.length <= 200 && !slug.includes('/') && !slug.includes('\\') && !slug.startsWith('.')
}

function noteFile(options: NoteRoutesOptions, day: PlainDate, slug: string): string {
  return path.join(options.timeDir, dayDir(day), noteDayPath(slug))
}

/** The note's path from its day's folder, as the day's line links it. */
function noteDayPath(slug: string): string {
  return `${actionKindRel('note')}/${slug}.md`
}

/** The day's own writers and the page take these in this order; a note's line takes them too. */
function withDayLock<T>(options: NoteRoutesOptions, ymd: string, run: () => Promise<T>): Promise<T> {
  const stateDir = options.stateDir ?? path.join(tmpdir(), `sky-day-${hash(options.timeDir)}`)
  return withLock(path.join(stateDir, 'planning.lock'), () =>
    options.dayLockDir ? withLock(path.join(options.dayLockDir, `day-${ymd}.lock`), run) : run(),
  )
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/**
 * What a note is called: its first `#` heading as plain words, else the opening words of its first
 * line, else "Note".
 */
export function noteTitle(content: string): string {
  const body = content.replace(FRONTMATTER, '')
  const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]
  const fromHeading = heading ? plainWords(heading) : ''
  if (fromHeading) return fromHeading
  const line = body
    .split(/\r?\n/)
    .map((text) => plainWords(text.replace(/^\s*(?:#+|[-*+]\s+\[[ xX]\]|[-*+>]|\d+[.)])\s*/, '')))
    .find((text) => text.length > 0)
  if (!line) return 'Note'
  const words = line.split(/\s+/)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : line
}

/** Inline markdown read as the words it shows: emphasis and code marks gone, a link as its text. */
function plainWords(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|[*_`])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The file's name from the title: case kept, never the blank page's own name. */
export function noteFileStem(title: string): string {
  const stem = slugify(title.replace(/…$/, ''), { suggestedLength: 40, preserveCase: true }) || 'Note'
  return stem.toLowerCase() === BLANK_PAGE ? `${stem}-Note` : stem
}

/**
 * The note as `notes:new` writes one: `summary`, `when` and `type` first in its front matter, then
 * whatever the page added there — tags, links — and the body as written.
 */
export function stampNote(content: string, title: string, time: string): string {
  const match = content.match(FRONTMATTER)
  const lines = match ? match[1]!.split(/\r?\n/).filter((line) => line.trim() !== '') : []
  const keyOf = (line: string) => line.match(/^([A-Za-z_][\w-]*):/)?.[1]
  const filled = (key: string) => lines.some((line) => keyOf(line) === key && line.slice(key.length + 1).trim() !== '')
  const stamped = [
    filled('summary') ? null : stringify({ summary: title }).trimEnd(),
    filled('when') ? null : `when: ${time}`,
    filled('type') ? null : 'type: Notes',
  ].filter((line): line is string => line !== null)
  const kept = lines.filter((line) => {
    const key = keyOf(line)
    return !(key && ['summary', 'when', 'type'].includes(key) && !filled(key))
  })
  const body = (match ? content.slice(match[0].length) : content).replace(/^(\r?\n)+/, '')
  return `---\n${[...stamped, ...kept].join('\n')}\n---\n\n${body}`
}

function noteWhen(content: string): string | null {
  const when = content.match(FRONTMATTER)?.[1]?.match(/^when:\s*['"]?(\d{1,2}:\d{2})/m)?.[1]
  return when ?? null
}

/** The day's line for a note, the way `notes:new` writes it. */
function dayLine(time: string, title: string, dayPath: string): string {
  return `${time} > Notes -> [${title.replace(/([[\]\\])/g, '\\$1')}](${dayPath})`
}

/** The day's line that links a note, and the Complete list it sits in. */
export function noteLine(
  content: string,
  dayPath: string,
): { list: string; raw: string; category: NoteCategory } | null {
  let list: string | null = null
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{2,6}\s+(.+?)\s*$/)
    if (heading) {
      list = heading[1]!
      continue
    }
    const category = list?.match(/^(Professional|Personal) Complete$/)?.[1] as NoteCategory | undefined
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    if (category && bullet && bullet[1]!.includes(`](${dayPath})`)) return { list: list!, raw: bullet[1]!, category }
  }
  return null
}
