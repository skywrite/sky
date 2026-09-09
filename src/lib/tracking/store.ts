import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { CaptureMoment } from '#commands/all/track/lib/moment.ts'
import { parseEntryDate, type ParsedEntry } from '#commands/all/track/lib/parse.ts'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import TrackingDocument, { type TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  fingerprint,
  missingFile,
  readTrackingFile,
  safeTrackingPath,
  withTrackingFiles,
  writeTrackingFile,
} from './files.ts'
import { loadTrackingHistory, trackingHistoryFiles } from './history.ts'
import {
  appendTrackingContents,
  findTrackingEntry,
  loadTrackingEntries,
  replaceTrackingRow,
  trackingDestination,
  type TrackingDirs,
} from './records.ts'
import {
  TrackingError,
  type Tracker,
  type TrackerInput,
  type TrackingMetric,
  type TrackingMutation,
  type TrackingPreview,
  type TrackingReport,
} from './types.ts'
import { normalizeTrackingValue } from './values.ts'

const DateSchema = z.string().refine((value) => parseEntryDate(value) !== null, 'Use a valid YYYY-MM-DD date.')
const SingleLine = z
  .string()
  .trim()
  .max(10_000)
  .refine((value) => !/[\r\n\0]/.test(value), 'Keep each answer on one line.')
export const OperationSchema = z.object({ operationId: z.uuid() })
export const RevisionSchema = OperationSchema.extend({ revision: z.string().min(1) })
export const EntryRefSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), date: DateSchema })
const ColumnSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(
        (value) =>
          !/[\r\n\0,]/.test(value) &&
          !/\s+\([^()]*\)$/.test(value) &&
          !['date', 'day', '__proto__', 'constructor', 'prototype'].includes(value.toLowerCase()),
        'Choose a different answer name.',
      ),
    type: z.enum(['time', 'number', 'duration', 'range', 'word', 'text']),
    unit: z
      .string()
      .trim()
      .max(60)
      .refine((value) => !/[\r\n\0()]/.test(value), 'Use a single-line unit without parentheses.')
      .optional(),
    aggregate: z.enum(['last', 'sum', 'mean', 'collect']).optional(),
  })
  .refine(
    (column) => !['sum', 'mean'].includes(column.aggregate ?? '') || ['number', 'duration'].includes(column.type),
    'Only numbers and durations can be added or averaged.',
  )
export const TrackerInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    question: SingleLine,
    category: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => !/[\/\\\r\n\0]/.test(value) && value !== '.' && value !== '..',
        'Use a category name, not a path.',
      ),
    ask: z.enum(['morning', 'evening', 'anytime']),
    schedule: z.enum(['daily', 'weekdays', 'manual']),
    columns: z
      .array(ColumnSchema)
      .min(1)
      .max(30)
      .refine(
        (columns) => new Set(columns.map((c) => c.name.toLowerCase())).size === columns.length,
        'Answer names must be unique.',
      ),
    start: DateSchema,
    end: DateSchema.nullable(),
    markdown: z.string().max(100_000),
  })
  .refine((input) => !input.end || input.end >= input.start, 'The end date must be on or after the start date.')
export const SaveEntrySchema = OperationSchema.extend({
  revision: z.string().min(1),
  entry: EntryRefSchema.optional(),
  date: DateSchema,
  values: z.record(z.string(), SingleLine),
})

interface Definition {
  doc: TrackingDocument
  raw: string
  file: string
  status: 'active' | 'archived'
}
interface Change {
  file: string
  before: string | null
  after: string | null
}
interface Receipt {
  id: string
  name: string
  request: string
  changes: Change[]
  undone?: boolean
}
export type TrackingParser = (
  definition: TrackingDocument,
  text: string,
  now: { date: string; time: string },
) => Promise<ParsedEntry | null>

export class TrackingStore {
  constructor(
    readonly dirs: TrackingDirs,
    readonly now: () => Promise<CaptureMoment>,
    readonly parse?: TrackingParser,
  ) {}

  private validateName(name: string): string {
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,119}$/u.test(name) || name.includes('..'))
      throw new TrackingError('Invalid tracker name.')
    return name
  }

  private async names(status: 'active' | 'archived'): Promise<string[]> {
    const dir = await safeTrackingPath(
      this.dirs.root,
      path.relative(this.dirs.root, path.join(this.dirs.trackingDir, status)),
    )
    try {
      return (await readdir(dir))
        .filter((name) => name.endsWith('.md'))
        .map((name) => name.slice(0, -3))
        .sort()
    } catch (error) {
      if (missingFile(error)) return []
      throw error
    }
  }

  private async definition(name: string, status?: 'active' | 'archived'): Promise<Definition> {
    this.validateName(name)
    for (const candidate of status ? [status] : (['active', 'archived'] as const)) {
      const file = await safeTrackingPath(
        this.dirs.root,
        path.relative(this.dirs.root, path.join(this.dirs.trackingDir, candidate, `${name}.md`)),
      )
      const raw = await readTrackingFile(file)
      if (raw === null) continue
      const doc = TrackingDocument.fromMarkdown(raw)
      if (doc.yamlError)
        throw new TrackingError('This tracker’s properties could not be read. Correct its markdown file first.')
      if (doc.name !== name)
        throw new TrackingError('This tracker’s name must match its filename before it can be edited.')
      if (/[\/\\]/.test(doc.category) || doc.category === '..')
        throw new TrackingError('This tracker has an invalid category.')
      return { doc, raw, file, status: candidate }
    }
    throw new TrackingError('This tracker no longer exists.', 404)
  }

  private async hasRecords(definition: TrackingDocument): Promise<boolean> {
    if (definition.storage === 'weekly') return true
    let years: string[]
    try {
      years = await readdir(this.dirs.dataTrackingDir)
    } catch (error) {
      if (missingFile(error)) return false
      throw error
    }
    for (const year of years.filter((year) => /^\d{4}$/.test(year))) {
      const file = await safeTrackingPath(
        this.dirs.root,
        path.relative(this.dirs.root, path.join(this.dirs.dataTrackingDir, year, definition.csvBasename)),
      )
      if ((await readTrackingFile(file))?.trim()) return true
    }
    return false
  }

  private async tracker(definition: Definition, hasEntries = false): Promise<Tracker> {
    const { doc, file, raw, status } = definition
    return {
      name: doc.name,
      title: doc.title,
      question: doc.question ?? '',
      category: doc.category,
      ask: doc.ask,
      schedule: doc.schedule,
      storage: doc.storage,
      status,
      columns: doc.columns,
      start: doc.start?.ymd ?? null,
      end: doc.end?.ymd ?? null,
      markdown: doc.markdown,
      path: path.relative(this.dirs.root, file),
      revision: fingerprint(raw),
      hasRecords: hasEntries || (await this.hasRecords(doc)),
    }
  }

  private state(name: string): string {
    return path.join(this.dirs.stateDir, name)
  }

  /** Finish an interrupted multi-file move only if every source still matches its journal. */
  private async recover(): Promise<void> {
    const pending = await readJson<Receipt>(this.state('pending.json'))
    if (!pending) return
    const files = await Promise.all(pending.changes.map((change) => safeTrackingPath(this.dirs.root, change.file)))
    await withTrackingFiles(files, async () => {
      for (let index = 0; index < files.length; index++) {
        const current = await readTrackingFile(files[index])
        const change = pending.changes[index]
        if (current !== change.before && current !== change.after)
          throw new TrackingError(
            'An interrupted tracking change conflicts with a file edit. Resolve the pending tracking transaction before continuing.',
            409,
          )
      }
      for (let index = 0; index < files.length; index++)
        if ((await readTrackingFile(files[index])) !== pending.changes[index].after)
          await writeTrackingFile(files[index], pending.changes[index].after)
      await writeJson(this.state(`receipts/${pending.id}.json`), pending)
      await writeJson(this.state('pending.json'), null)
    })
  }

  private async ready<T>(run: () => Promise<T>): Promise<T> {
    return withProcessLock(this.state('write.lock'), async () => {
      await this.recover()
      return run()
    })
  }

  private async mutate(
    operationId: string,
    name: string,
    input: unknown,
    prepare: () => Promise<Change[]>,
  ): Promise<TrackingMutation> {
    const id = z.uuid().parse(operationId)
    const request = fingerprint(JSON.stringify({ name, input }))
    return this.ready(async () => {
      const prior = await readJson<Receipt>(this.state(`receipts/${id}.json`))
      if (prior) {
        if (prior.request !== request || prior.undone)
          throw new TrackingError('This change was already used. Reload before trying again.', 409)
        return { name: prior.name, undoId: prior.id }
      }
      const changes = await prepare()
      const files = await Promise.all(changes.map((change) => safeTrackingPath(this.dirs.root, change.file)))
      return withTrackingFiles(files, async () => {
        for (let index = 0; index < changes.length; index++) {
          if ((await readTrackingFile(files[index])) !== changes[index].before)
            throw new TrackingError('A tracking file changed. Reload and try again.', 409)
        }
        const receipt: Receipt = { id, name, request, changes }
        await writeJson(this.state('pending.json'), receipt)
        for (let index = 0; index < changes.length; index++)
          if (changes[index].before !== changes[index].after)
            await writeTrackingFile(files[index], changes[index].after)
        await writeJson(this.state(`receipts/${id}.json`), receipt)
        await writeJson(this.state('pending.json'), null)
        return { name, undoId: id }
      })
    })
  }

  private change(file: string, before: string | null, after: string | null): Change {
    return { file: path.relative(this.dirs.root, file), before, after }
  }

  private checkRevision(definition: Definition, revision: string): void {
    if (fingerprint(definition.raw) !== revision)
      throw new TrackingError('This tracker changed. Reload its settings before saving.', 409)
  }

  async report(
    startInput?: string,
    endInput?: string,
    only?: string,
    days: number | 'all' = 30,
  ): Promise<TrackingReport> {
    return this.ready(async () => {
      const now = await this.now()
      const allTime = days === 'all'
      if (allTime && (startInput || endInput)) throw new TrackingError('Choose All time or a specific date range.')
      const count = allTime ? 1 : z.number().int().min(1).max(36600).parse(days)
      let start = startInput ? new PlainDate(DateSchema.parse(startInput)) : now.date.addDays(1 - count)
      let end = endInput ? new PlainDate(DateSchema.parse(endInput)) : now.date
      if (start.ymd > end.ymd || start.addDays(36600).ymd < end.ymd)
        throw new TrackingError('Choose a date range of up to 100 years, with the start before the end.')
      const names = only
        ? [this.validateName(only)]
        : [...new Set([...(await this.names('active')), ...(await this.names('archived'))])]
      const metrics: TrackingMetric[] = [],
        errors: TrackingReport['errors'] = []
      let history: Promise<string[]> | undefined
      for (const name of names) {
        try {
          const definition = await this.definition(name)
          const data = allTime
            ? await loadTrackingHistory(this.dirs, definition.doc, await (history ??= trackingHistoryFiles(this.dirs)))
            : await loadTrackingEntries(this.dirs, definition.doc, start, end)
          metrics.push({ tracker: await this.tracker(definition, data.entries.length > 0), ...data })
          if (allTime) {
            const first = data.entries[0]?.date,
              last = data.entries.at(-1)?.date
            if (first && first < start.ymd) start = new PlainDate(first)
            if (last && last > end.ymd) end = new PlainDate(last)
          }
        } catch (error) {
          errors.push({ name, message: error instanceof Error ? error.message : String(error) })
        }
      }
      return {
        today: now.date.ymd,
        time: now.time,
        start: start.ymd,
        end: end.ymd,
        window: Number(now.time.split(':')[0]) >= 16 ? 'evening' : 'morning',
        metrics,
        errors,
        canParse: !!this.parse,
      }
    })
  }

  async create(operationId: string, raw: unknown): Promise<TrackingMutation> {
    const input = TrackerInputSchema.parse(raw)
    const base =
      input.title
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'tracker'
    const name = ['new', '_api'].includes(base) ? `${base}-tracker` : base
    return this.mutate(operationId, name, { create: input }, async () => {
      if ((await this.names('active')).includes(name) || (await this.names('archived')).includes(name))
        throw new TrackingError('A tracker with this name already exists. Choose another name.', 409)
      const now = await this.now()
      const doc = TrackingDocument.create({
        name,
        ...input,
        start: new PlainDate(input.start),
        end: input.end ? new PlainDate(input.end) : undefined,
        createdOn: now.date.ymd,
      })
      const contents = new TrackingDocument(doc.yaml, input.markdown).toMarkdown()
      const file = await safeTrackingPath(
        this.dirs.root,
        path.relative(this.dirs.root, path.join(this.dirs.trackingDir, 'active', `${name}.md`)),
      )
      return [this.change(file, null, contents)]
    })
  }

  async configure(name: string, operationId: string, revision: string, raw: unknown): Promise<TrackingMutation> {
    const input = TrackerInputSchema.parse(raw)
    return this.mutate(operationId, name, { configure: input, revision }, async () => {
      const definition = await this.definition(name)
      this.checkRevision(definition, revision)
      const previous = definition.doc.columns
      const changedSchema = previous.some(
        (column) =>
          !input.columns.some(
            (next) =>
              next.name === column.name && next.type === column.type && (next.unit || '') === (column.unit || ''),
          ),
      )
      if (changedSchema) {
        const now = await this.now()
        const legacy = await loadTrackingEntries(
          this.dirs,
          definition.doc,
          definition.doc.start ?? now.date.addDays(-3650),
          now.date,
        )
        if ((await this.hasRecords(definition.doc)) || legacy.entries.length)
          throw new TrackingError(
            'Existing answers keep their names, formats, and units so history stays readable. Add a new answer or create another tracker.',
          )
      }
      if (definition.doc.storage === 'weekly' && input.category !== definition.doc.category)
        throw new TrackingError('This legacy tracker keeps its category so its existing records stay connected.')
      const now = await this.now()
      const { markdown, ...properties } = input
      const doc = new TrackingDocument({ ...definition.doc.yaml, ...properties, updated: now.date.ymd }, markdown)
      return [this.change(definition.file, definition.raw, doc.toMarkdown())]
    })
  }

  async setStatus(
    name: string,
    operationId: string,
    revision: string,
    status: 'active' | 'archived',
  ): Promise<TrackingMutation> {
    return this.mutate(operationId, name, { status, revision }, async () => {
      const definition = await this.definition(name)
      this.checkRevision(definition, revision)
      if (definition.status === status) return []
      const now = await this.now()
      const doc = status === 'archived' ? definition.doc.archive(now.date) : definition.doc.updateYaml({ end: null })
      const next = doc.updateYaml({ updated: now.date.ymd }).toMarkdown()
      const destination = path.join(this.dirs.trackingDir, status, `${name}.md`)
      if ((await readTrackingFile(destination)) !== null)
        throw new TrackingError('A tracker already exists at the destination.', 409)
      return [this.change(destination, null, next), this.change(definition.file, definition.raw, null)]
    })
  }

  private values(columns: TrackingColumn[], input: Record<string, string>, time?: string): Record<string, string> {
    const known = new Set(columns.map((column) => column.name))
    if (Object.keys(input).some((name) => !known.has(name)))
      throw new TrackingError('An answer is no longer part of this tracker. Reload the entry form.')
    const values: Record<string, string> = Object.create(null)
    for (const column of columns) {
      try {
        values[column.name] = normalizeTrackingValue(
          column,
          input[column.name] ?? (column.type === 'time' ? (time ?? '') : ''),
        )
      } catch (error) {
        throw new TrackingError((error as Error).message)
      }
    }
    if (
      !columns.some(
        (column) =>
          column.name !== 'notes' &&
          values[column.name] &&
          (column.type !== 'time' || columns.every((c) => c.type === 'time' || c.name === 'notes')),
      )
    )
      throw new TrackingError('Enter at least one answer before saving.')
    return values
  }

  async saveEntry(name: string, raw: unknown): Promise<TrackingMutation> {
    const input = SaveEntrySchema.parse(raw)
    return this.mutate(input.operationId, name, { save: input }, async () => {
      const definition = await this.definition(name)
      this.checkRevision(definition, input.revision)
      if (definition.status === 'archived' && !input.entry)
        throw new TrackingError('Restore this tracker before logging a new entry.')
      const now = await this.now(),
        date = new PlainDate(input.date)
      const values = this.values(definition.doc.columns, input.values, input.entry ? undefined : now.time)
      const destination = await trackingDestination(this.dirs, definition.doc, date)
      const guards = [this.change(definition.file, definition.raw, definition.raw)]
      if (!input.entry) {
        const before = await readTrackingFile(destination)
        return [
          ...guards,
          this.change(
            destination,
            before,
            appendTrackingContents(this.dirs, destination, before, definition.doc, date, values),
          ),
        ]
      }
      const { source, entry } = await findTrackingEntry(this.dirs, definition.doc, input.entry)
      const merged = { ...entry.values, ...values }
      // Preserve a source file while changing a day within its own year/week.
      const samePeriod = source.file.startsWith(this.dirs.dataTrackingDir + path.sep)
        ? date.year === new PlainDate(entry.date).year
        : date.addDays(1 - date.dayOfWeek).ymd ===
          new PlainDate(entry.date).addDays(1 - new PlainDate(entry.date).dayOfWeek).ymd
      if (samePeriod)
        return [
          ...guards,
          this.change(
            source.file,
            source.contents,
            replaceTrackingRow(source, definition.doc, entry.line, date, merged),
          ),
        ]
      const before = await readTrackingFile(destination)
      // Unknown historical fields must survive a move as named text answers.
      const extra = source.header
        .slice(1)
        .map((label) => label.replace(/\s+\([^()]*\)$/, ''))
        .filter((column) => !definition.doc.columns.some((c) => c.name === column))
      const moving = definition.doc.updateYaml({
        columns: [...definition.doc.columns, ...extra.map((column) => ({ name: column, type: 'text' }))],
      })
      return [
        ...guards,
        this.change(destination, before, appendTrackingContents(this.dirs, destination, before, moving, date, merged)),
        this.change(source.file, source.contents, replaceTrackingRow(source, definition.doc, entry.line, date, null)),
      ]
    })
  }

  async deleteEntry(name: string, operationId: string, ref: { id: string; date: string }): Promise<TrackingMutation> {
    EntryRefSchema.parse(ref)
    return this.mutate(operationId, name, { delete: ref }, async () => {
      const definition = await this.definition(name)
      const { source, entry } = await findTrackingEntry(this.dirs, definition.doc, ref)
      return [
        this.change(
          source.file,
          source.contents,
          replaceTrackingRow(source, definition.doc, entry.line, new PlainDate(entry.date), null),
        ),
      ]
    })
  }

  async undo(id: string): Promise<void> {
    z.uuid().parse(id)
    await this.ready(async () => {
      const receipt = await readJson<Receipt>(this.state(`receipts/${id}.json`))
      if (!receipt) throw new TrackingError('This undo is no longer available.', 404)
      if (receipt.undone) return
      const files = await Promise.all(receipt.changes.map((change) => safeTrackingPath(this.dirs.root, change.file)))
      await withTrackingFiles(files, async () => {
        for (let index = 0; index < files.length; index++) {
          if ((await readTrackingFile(files[index])) !== receipt.changes[index].after)
            throw new TrackingError('The file changed after this action. Open its history to make a correction.', 409)
        }
        const reversed: Receipt = {
          ...receipt,
          undone: true,
          changes: receipt.changes.map((change) => ({ ...change, before: change.after, after: change.before })),
        }
        await writeJson(this.state('pending.json'), reversed)
        for (let index = 0; index < files.length; index++)
          if (reversed.changes[index].before !== reversed.changes[index].after)
            await writeTrackingFile(files[index], reversed.changes[index].after)
        await writeJson(this.state(`receipts/${id}.json`), reversed)
        await writeJson(this.state('pending.json'), null)
      })
    })
  }

  async preview(name: string, text: string): Promise<TrackingPreview> {
    const definition = await this.definition(name)
    if (!this.parse)
      return {
        date: null,
        values: {},
        message: 'Sentence parsing is unavailable. Fill in the fields to record this entry.',
      }
    const now = await this.now()
    const parsed = await this.parse(definition.doc, z.string().trim().min(1).max(10_000).parse(text), {
      date: now.date.ymd,
      time: now.time,
    })
    if (!parsed)
      return { date: null, values: {}, message: 'Sky could not read this entry. Fill in the fields to keep going.' }
    // An unclear date stays unresolved; the preview never silently substitutes today.
    return {
      date: parsed.date?.ymd ?? null,
      values: parsed.values,
      message: parsed.date ? null : 'Choose the date this entry belongs to.',
    }
  }
}
