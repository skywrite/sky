import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Marked } from 'marked'
import { z } from 'zod'
import { insertBlock } from '#lib/nbfs/listBlocks.ts'
import { writePlanningChanges, type PlanningChange } from '#lib/nbfs/planningChanges.ts'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import { createStreakClassifier, resolveStreakCategory, type StreakClassifier } from '#lib/streaks/category.ts'
import slugify from '#lib/string/slugify.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import StreakDocument, {
  computeStreakStats,
  STREAKS_LIST_TITLE,
  STREAK_CATEGORIES,
  streaksItemsFromDay,
  type StreakDayEntry,
} from '#shared/models/Streak/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { dayEnd } from '../day/ended.ts'
import isDay from '../day/isDay.ts'
import type { StreakDayView, StreakMutation, StreakReport, StreakView } from './types.ts'

export class StreaksError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
  }
}

export interface StreaksPaths {
  root: string
  timeDir: string
  streaksDir: string
  stateDir?: string
  /** These are the same locks used by day planning and workstream projection. */
  dayStateDir?: string
  workstreamsStateDir?: string
}

const Name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/, 'Invalid streak name.')
const Day = z.string().refine(isDay, 'Use a real date in YYYY-MM-DD format.')
const Create = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Give the streak a title.')
      .max(160)
      .refine(
        (value) =>
          !/[\r\n~]/.test(value) &&
          !/^\d{1,2}:\d{2}\s*>/.test(value) &&
          StreakDocument.parseDayItemTitle(value) === value,
        'Use a single-line title without completion marks or a trailing streak count.',
      ),
    rule: z.string().trim().min(1, 'Describe what counts.').max(10_000),
    why: z.string().trim().max(10_000).default(''),
    category: z.enum(STREAK_CATEGORIES).optional(),
    schedule: z.enum(['daily', 'weekdays']),
    start: Day,
    end: Day.nullish(),
  })
  .refine((value) => !value.end || value.end >= value.start, {
    message: 'The end date must be on or after the start date.',
    path: ['end'],
  })
const Completion = z.object({ date: Day, done: z.boolean(), expectedDone: z.boolean() })
const Archive = z.object({ revision: z.string().min(1), category: z.enum(STREAK_CATEGORIES).optional() })
const Category = z.object({ revision: z.string().min(1), category: z.enum(STREAK_CATEGORIES) })

interface Loaded {
  file: string
  content: string
  document: StreakDocument
  status: 'active' | 'archived'
}

interface UndoRecord {
  name: string
  expires: number
  changes: PlanningChange[]
  day?: string
}

const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  )
const safeHref = (href: string): boolean => {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href, 'https://example.com').protocol)
  } catch {
    return false
  }
}
const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return safeHref(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label
    },
    image: ({ href, text }) =>
      safeHref(href) ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">` : escapeHtml(text),
  },
})

/** Read the conventional sections without discarding any free-form document body. */
function narrative(document: StreakDocument): { why: string; rule: string } {
  const body = document.markdown.replace(/^\s*# [^\n]*\n/, '').trim()
  const sections = [...body.matchAll(/^##\s+(.+)\s*$/gm)]
  let why = sections.length ? body.slice(0, sections[0].index).trim() : body
  let rule = ''
  for (let index = 0; index < sections.length; index++) {
    const heading = sections[index]
    const text = body.slice(heading.index! + heading[0].length, sections[index + 1]?.index).trim()
    if (/^(why|purpose)$/i.test(heading[1].trim())) why = text
    if (/^(what counts|rules?|details)$/i.test(heading[1].trim())) rule = text
  }
  return { why, rule }
}

function withStreakItem(content: string, title: string): string {
  const restored = DayDocument.restoreItem(content, STREAKS_LIST_TITLE, title, Number.MAX_SAFE_INTEGER)
  if (restored.kind === 'written') return restored.content
  if (restored.kind === 'unchanged') return content
  // Add only the missing section; parsing and reserializing the whole day would
  // also rewrite unrelated lists and reference links.
  const complete = /^##\s+[^\n]*Complete\s*$/m.exec(content)
  const at = complete?.index ?? content.length
  const before = content.slice(0, at)
  return `${before}${before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'}## Streaks\n\n- ${title}\n\n${content.slice(at)}`
}

export class StreaksStore {
  readonly stateDir: string
  private readonly undos = new Map<string, UndoRecord>()

  constructor(
    readonly paths: StreaksPaths,
    private readonly now: () => Promise<PlainDateTime> = async () => new PlainDateTime(),
    private readonly classify: StreakClassifier = createStreakClassifier(paths.root),
  ) {
    this.stateDir = paths.stateDir ?? path.join(tmpdir(), `sky-streaks-${hash(paths.streaksDir)}`)
  }

  private async today(): Promise<PlainDate> {
    return (await this.now()).plainDate
  }

  private relative(file: string): string {
    return path.relative(this.paths.root, file).split(path.sep).join('/')
  }

  /** Never follow a notebook symlink when reading or changing a streak/day record. */
  private async checked(file: string, allowMissing = false): Promise<void> {
    const relative = path.relative(this.paths.root, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new StreaksError('Invalid notebook path.')
    let cursor = this.paths.root
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part)
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new StreaksError('Streaks cannot use symbolic links.')
      } catch (error) {
        if (allowMissing && missing(error)) return
        throw error
      }
    }
  }

  private async load(): Promise<{ streaks: Loaded[]; warnings: string[] }> {
    const streaks: Loaded[] = []
    const warnings: string[] = []
    const visit = async (dir: string, status: Loaded['status']): Promise<void> => {
      let children
      try {
        await this.checked(dir, true)
        children = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (missing(error)) return
        warnings.push(`Could not read ${this.relative(dir)}.`)
        return
      }
      for (const entry of children) {
        const file = path.join(dir, entry.name)
        if (entry.isSymbolicLink()) {
          warnings.push(`Skipped symbolic link ${this.relative(file)}.`)
        } else if (entry.isDirectory()) await visit(file, status)
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            await this.checked(file)
            const content = await readFile(file, 'utf8')
            const document = StreakDocument.fromMarkdown(content)
            Name.parse(document.name)
            if (document.yamlError || typeof document.title !== 'string' || !document.title.trim())
              throw new Error('Invalid streak')
            streaks.push({ file, content, document, status })
            if (!document.start)
              warnings.push(`${document.title} has no valid start date; open its document to set one.`)
            if (document.yaml.end && !document.end)
              warnings.push(`${document.title} has an invalid end date; open its document to correct it.`)
            if (document.yaml.schedule && !['daily', 'weekdays'].includes(document.yaml.schedule as string))
              warnings.push(`${document.title} has an unsupported schedule; open its document to correct it.`)
          } catch {
            warnings.push(`Could not read streak ${this.relative(file)}.`)
          }
        }
      }
    }
    await visit(path.join(this.paths.streaksDir, 'active'), 'active')
    await visit(path.join(this.paths.streaksDir, 'archived'), 'archived')
    streaks.sort((a, b) => a.document.name.localeCompare(b.document.name))
    for (const streak of streaks) {
      if (
        streaks.some(
          (other) => other !== streak && other.document.title.toLowerCase() === streak.document.title.toLowerCase(),
        )
      )
        warnings.push(
          `More than one streak uses the title “${streak.document.title}”. Review the documents before checking it off.`,
        )
      if (streaks.some((other) => other !== streak && other.document.name === streak.document.name))
        warnings.push(
          `More than one streak uses the name “${streak.document.name}”. Review the documents before changing it.`,
        )
    }
    return { streaks, warnings: [...new Set(warnings)] }
  }

  async report(): Promise<StreakReport> {
    const today = await this.today()
    const { streaks, warnings } = await this.load()
    let first = today
    for (const { document } of streaks) if (document.start && document.start.ymd < first.ymd) first = document.start
    const days: StreakDayView[] = []
    const entries: StreakDayEntry[] = []
    // Read only day.md paths, in bounded batches; do not walk attachments or actions.
    for (let cursor = first; cursor.ymd <= today.ymd;) {
      const batch: PlainDate[] = []
      for (let index = 0; index < 32 && cursor.ymd <= today.ymd; index++, cursor = cursor.addDays(1)) batch.push(cursor)
      await Promise.all(
        batch.map(async (date) => {
          const file = path.join(this.paths.timeDir, dayFile(date))
          try {
            await this.checked(file)
            const document = DayDocument.fromMarkdown(await readFile(file, 'utf8'))
            if (document.yamlError) throw new Error('Invalid day')
            days.push({ date: date.ymd, relativePath: this.relative(file), ended: dayEnd(document).ended })
            entries.push({ day: date, items: streaksItemsFromDay(document) })
          } catch (error) {
            if (!missing(error)) warnings.push(`Could not read the day record for ${date.ymd}.`)
          }
        }),
      )
    }
    entries.sort((a, b) => a.day.ymd.localeCompare(b.day.ymd))
    days.sort((a, b) => a.date.localeCompare(b.date))
    const views = await Promise.all(
      streaks.map(async ({ document, file, content, status }): Promise<StreakView> => {
        const stats = computeStreakStats(document, entries, today)
        const context = narrative(document)
        return {
          name: document.name,
          title: document.title,
          category: document.category ?? null,
          schedule: document.schedule,
          start: document.start?.ymd ?? null,
          end: document.end?.ymd ?? null,
          status,
          relativePath: this.relative(file),
          revision: hash(content),
          ...context,
          whyHtml: await markdown.parse(context.why, { async: false }),
          ruleHtml: await markdown.parse(context.rule, { async: false }),
          bodyHtml: await markdown.parse(document.markdown, { async: false }),
          done: entries
            .filter(({ day, items }) => {
              const matches = items.filter((item) => document.matchesDayItem(item))
              if (matches.length > 1)
                warnings.push(
                  `The day record for ${day.ymd} contains duplicate items for “${document.title}”. Review it before changing its completion.`,
                )
              return document.isTrackedOn(day) && matches.length > 0 && DayDocument.isItemDone(matches[0])
            })
            .map(({ day }) => day.ymd),
          current: stats.current,
          best: stats.best,
        }
      }),
    )
    return { today: today.ymd, streaks: views, days, warnings }
  }

  private async required(name: string): Promise<Loaded> {
    Name.parse(name)
    const { streaks } = await this.load()
    const matches = streaks.filter(({ document }) => document.name === name)
    if (!matches.length) throw new StreaksError('This streak could not be found.', 404)
    if (matches.length !== 1)
      throw new StreaksError('More than one document uses this streak name. Review the documents first.', 409)
    const result = matches[0]
    if (result.document.yaml.end && !result.document.end)
      throw new StreaksError('This streak has an invalid end date. Review its document first.', 409)
    if (result.document.yaml.schedule && !['daily', 'weekdays'].includes(result.document.yaml.schedule as string))
      throw new StreaksError('This streak has an unsupported schedule. Review its document first.', 409)
    if (
      streaks.some(
        (other) => other !== result && other.document.title.toLowerCase() === result.document.title.toLowerCase(),
      )
    )
      throw new StreaksError('More than one streak uses this title. Review the documents first.', 409)
    return result
  }

  private async changed(file: string, expected: string): Promise<void> {
    await this.checked(file, true)
    if ((await readOptional(file)) !== expected)
      throw new StreaksError('The file changed. Refresh before trying again.', 409)
  }

  private remember(record: Omit<UndoRecord, 'expires'>): string {
    const now = performance.now()
    for (const [id, undo] of this.undos) if (undo.expires < now) this.undos.delete(id)
    const id = randomUUID()
    this.undos.set(id, { ...record, expires: now + 60_000 })
    return id
  }

  private async dayWrite<T>(date: string, action: () => Promise<T>): Promise<T> {
    const state = this.paths.dayStateDir ?? path.join(tmpdir(), `sky-day-${hash(this.paths.timeDir)}`)
    return withLock(path.join(state, 'planning.lock'), async () =>
      this.paths.workstreamsStateDir
        ? withLock(path.join(this.paths.workstreamsStateDir, `day-${date}.lock`), action)
        : action(),
    )
  }

  async create(input: unknown): Promise<StreakMutation> {
    const value = Create.parse(input)
    const draft = new StreakDocument(
      { title: value.title },
      StreakDocument.createTemplate({ title: value.title, why: value.why, details: `## What counts\n\n${value.rule}` }),
    )
    const category = await resolveStreakCategory(draft, value.category, this.classify)
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const { streaks, warnings } = await this.load()
      if (warnings.some((warning) => warning.startsWith('Could not read')))
        throw new StreaksError(
          'Some streak documents could not be read. Review them before creating another streak.',
          409,
        )
      if (streaks.some(({ document }) => document.title.toLowerCase() === value.title.toLowerCase()))
        throw new StreaksError(
          'A streak already uses this title. Choose a different title so its history stays distinct.',
          409,
        )
      const base =
        slugify(value.title)
          .replace(/^-+|-+$/g, '')
          .slice(0, 100) || 'streak'
      let name = base
      for (let suffix = 2; streaks.some(({ document }) => document.name.toLowerCase() === name.toLowerCase()); suffix++)
        name = `${base}-${suffix}`
      Name.parse(name)
      const today = await this.today()
      const document = StreakDocument.create({
        name,
        title: value.title,
        category: category.category,
        schedule: value.schedule,
        start: new PlainDate(value.start),
        end: value.end ? new PlainDate(value.end) : undefined,
        why: value.why,
        details: `## What counts\n\n${value.rule}`,
        createdOn: today.ymd,
      })
      const file = path.join(this.paths.streaksDir, 'active', `${name}.md`)
      await this.checked(file, true)
      await mkdir(path.dirname(file), { recursive: true })
      try {
        await writeFile(file, document.toMarkdown(), { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new StreaksError('That streak file already exists. Refresh and try again.', 409)
        throw error
      }
      return { name, message: category.warning ? `Streak created. ${category.warning}` : 'Streak created.' }
    })
  }

  async setCategory(name: string, input: unknown): Promise<StreakMutation> {
    const { revision, category } = Category.parse(input)
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const streak = await this.required(name)
      if (streak.status !== 'active') throw new StreaksError('Set the category before archiving the streak.', 409)
      if (hash(streak.content) !== revision)
        throw new StreaksError('This streak changed. Refresh before changing its category.', 409)
      const today = await this.today()
      const after = streak.document.updateYaml({ category, updated: today.ymd }).toMarkdown()
      await this.changed(streak.file, streak.content)
      await atomicWrite(streak.file, after)
      return { name, message: `Category set to ${category}.` }
    })
  }

  async completion(name: string, input: unknown): Promise<StreakMutation> {
    const value = Completion.parse(input)
    return withLock(path.join(this.stateDir, 'write.lock'), () =>
      this.dayWrite(value.date, async () => {
        const streak = await this.required(name)
        const today = await this.today()
        const date = new PlainDate(value.date)
        if (date.ymd > today.ymd) throw new StreaksError('Future days cannot be checked off.')
        if (!streak.document.isTrackedOn(date)) throw new StreaksError('This streak is not scheduled on that day.')
        const file = path.join(this.paths.timeDir, dayFile(date))
        await this.checked(file, true)
        const before = await readOptional(file)
        if (before === undefined) throw new StreaksError('Start this day in Sky before checking off a streak.', 409)
        const day = DayDocument.fromMarkdown(before)
        if (day.yamlError) throw new StreaksError('This day record could not be read.', 409)
        if (dayEnd(day).ended) throw new StreaksError('This day has ended. Its streaks are read-only.', 409)
        const matches = streaksItemsFromDay(day).filter((item) => streak.document.matchesDayItem(item))
        if (matches.length > 1)
          throw new StreaksError('This day contains duplicate streak items. Review its record first.', 409)
        const done = matches.length > 0 && DayDocument.isItemDone(matches[0])
        if (done !== value.expectedDone)
          throw new StreaksError('This completion changed. Refresh before trying again.', 409)
        if (done === value.done) return { name, message: done ? 'Already complete.' : 'Already incomplete.' }
        const stamped = matches.length ? before : withStreakItem(before, streak.document.title)
        const raw = matches[0] ?? streak.document.title
        const result = DayDocument.toggleItem(stamped, STREAKS_LIST_TITLE, raw, value.done)
        if (result.kind !== 'written') throw new StreaksError('The day changed. Refresh before trying again.', 409)
        await this.changed(streak.file, streak.content)
        await this.changed(file, before)
        await atomicWrite(file, result.content)
        const undoId = this.remember({ name, changes: [{ file, before, after: result.content }], day: date.ymd })
        return { name, undoId, message: value.done ? 'Streak completed.' : 'Completion removed.' }
      }),
    )
  }

  async archive(name: string, input: unknown): Promise<StreakMutation> {
    const { revision, category: override } = Archive.parse(input)
    const current = async () => {
      const streak = await this.required(name)
      if (streak.status !== 'active') throw new StreaksError('This streak is already archived.', 409)
      if (hash(streak.content) !== revision)
        throw new StreaksError('This streak changed. Refresh before archiving it.', 409)
      return streak
    }
    // Inference can take seconds. Keep it outside the writer locks, then recheck the revision.
    const category = await resolveStreakCategory((await current()).document, override, this.classify)
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const streak = await current()
      const now = await this.now()
      const today = now.plainDate
      return this.dayWrite(today.ymd, async () => {
        const dayPath = path.join(this.paths.timeDir, dayFile(today))
        await this.checked(dayPath, true)
        const before = await readOptional(dayPath)
        const day = before === undefined ? DayDocument.createFutureDay(today) : DayDocument.fromMarkdown(before)
        if (day.yamlError) throw new StreaksError('This day record could not be read.', 409)
        if (dayEnd(day).ended)
          throw new StreaksError('This day has ended. Start a new day before archiving a streak.', 409)
        const dayItem = `${now.time} > streaks/${name} -> Archived | ${streak.document.title}`
        const list = `${category.category ?? 'Personal'} Complete`
        const dayAfter = insertBlock(before ?? day.toMarkdown(), list, `- ${dayItem}`)
        const end = streak.document.end && streak.document.end.ymd < today.ymd ? streak.document.end.ymd : today.ymd
        const after = streak.document
          .updateYaml({ end, updated: today.ymd, ...(category.category ? { category: category.category } : {}) })
          .toMarkdown()
        const file = path.join(this.paths.streaksDir, 'archived', `${name}.md`)
        await this.checked(file, true)
        await this.changed(streak.file, streak.content)
        // Publish the archive and its day record before removing the active rule.
        const changes: PlanningChange[] = [
          { file, before: undefined, after },
          { file: dayPath, before, after: dayAfter },
          { file: streak.file, before: streak.content, after: undefined },
        ]
        await writePlanningChanges(changes)
        const undoId = this.remember({ name, changes, day: today.ymd })
        return {
          name,
          undoId,
          message: category.warning
            ? 'Streak archived. Category could not be determined; recorded in Personal Complete.'
            : `Streak archived. Recorded in ${list}.`,
        }
      })
    })
  }

  async undo(id: string): Promise<StreakMutation> {
    z.uuid().parse(id)
    return withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const record = this.undos.get(id)
      if (!record || record.expires < performance.now())
        throw new StreaksError('Undo expired. Review the current record.', 409)
      const restore = async (): Promise<StreakMutation> => {
        for (const change of record.changes) await this.checked(change.file, true)
        const day = record.day
          ? record.changes.find((change) => change.file === path.join(this.paths.timeDir, dayFile(record.day!)))
          : undefined
        if (day?.after && dayEnd(DayDocument.fromMarkdown(day.after)).ended)
          throw new StreaksError('This day has ended. Its streaks are read-only.', 409)
        await writePlanningChanges(
          record.changes.toReversed().map(({ file, before, after }) => ({ file, before: after, after: before })),
        )
        this.undos.delete(id)
        return { name: record.name, message: 'Change undone.' }
      }
      return record.day ? this.dayWrite(record.day, restore) : restore()
    })
  }
}
