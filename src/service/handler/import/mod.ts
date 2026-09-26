/**
 * Meeting from a file — the service's side of dropping a transcript, a
 * recording, a screenshot or a dragged text on the day.
 *
 * A drop becomes a job: the upload staged under the user-data directory,
 * read back at once (length, speakers, turns; for a recording the first
 * minute heard; for a screenshot its pixels), then, on Start, the matching
 * command run in-process the way the terminal runs it. The command's output
 * is the job's progress and its questions park on the job until the browser
 * answers; everything the job says travels as server-sent events, replayed
 * from the start on every connection so a page reopened mid-way shows all
 * of it.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { documentWorkWhen } from '#commands/all/notes/lib/documentInput.ts'
import type { RunEvent } from '#commands/lib/core/runCommand.ts'
import { instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../activity.ts'
import { safeAttachmentName } from '../attachments/mod.ts'
import { linkValues } from '../links/mod.ts'
import type { ImportLinksHost } from '../links/types.ts'
import {
  type CalendarMatch,
  type ImportJob,
  isSettled,
  type JobRecord,
  JobStore,
  type Listen,
  progressLine,
  type PromptOnWire,
  type Resume,
  type StagedFile,
  type StartFields,
  summarize,
} from './jobs.ts'
import { KINDS, type ReadBack, readSelection, sourceOf } from './readback.ts'

export type {
  CalendarMatch,
  ImportEvent,
  ImportJob,
  ImportState,
  Listen,
  PromptOnWire,
  Resume,
  Stage,
  StagedFile,
  StartFields,
  Tick,
} from './jobs.ts'
export type { ImportKind, ImportSource, ReadBack } from './readback.ts'
export type { RunEvent } from '#commands/lib/core/runCommand.ts'

export type RunOutcome = { ok: true; file: string | null } | { ok: false; message: string; file?: string | null }

export interface ImportRoutesOptions {
  links?: ImportLinksHost
  /** The clock the sweep of finished imports reads — a test seam; the wall clock otherwise */
  now?: () => number
  /** Where uploads and their job files live */
  dir: string
  /** What a staged file is, read locally before anything runs */
  read: (file: { path: string; name: string; size: number }) => Promise<ReadBack>
  /** The when sky proposes for a file, notebook time, YYYY-MM-DD HH:MM */
  suggestWhen: (file: StagedFile, readback: ReadBack) => string
  /** The first minute of a recording, heard; absent or null when it cannot be */
  listen?: (filePath: string, jobDir: string) => Promise<Listen | null>
  /** The opening words of one CAF clip, so the person can tell the clips apart before naming who speaks */
  opening?: (filePath: string, jobDir: string) => Promise<string | null>
  /** A calendar event near the suggested when; absent or null when there is none */
  calendar?: (when: string, readback: ReadBack) => Promise<CalendarMatch | null>
  /**
   * The pipeline's run record for the file: its key, from the file's bytes
   * unless one is already known, and what an earlier run left to pick up.
   * Absent when the host keeps no records.
   */
  record?: (file: {
    path: string
    paths?: string[]
    key: string | null
  }) => Promise<{ key: string; resume: Resume | null }>
  /**
   * Run the import as the person asked: the door command with the job's
   * fields, as one stream of what it reports and asks, ending in how it went.
   * The signal is the person's cancel.
   */
  run: (job: ImportJob, filePaths: string[], signal: AbortSignal) => AsyncGenerator<RunEvent, RunOutcome, void>
  /** The journal types the dialog offers */
  journalTypes: string[]
}

/** "Voice memo 9:14", "Screenshot 7:44", "Text 16:02", or the file's name without its extension. */
function titleOf(file: StagedFile, readback: ReadBack, when: string): string {
  const time = when.slice(11).replace(/^0/, '')
  if (readback.source === 'audio') return `Voice memo ${time}`
  if (readback.source === 'imessage-audio') return `iMessage Audio ${time}`
  if (readback.source === 'image') return `Screenshot ${time}`
  if (readback.source === 'selection') return `Text ${time}`
  return file.name.replace(/\.[^.]+$/, '')
}

/** What a dragged text is staged as: a file like any other, for the door to read. */
const SELECTION_FILE = 'selection.txt'

/** What a parked question is about, for the row. */
function promptTitle(prompt: PromptOnWire): string {
  if (prompt.kind === 'form') return prompt.prompt.title
  return prompt.prompt.message.replace(/\s*\(.*\)\s*$/, '')
}

/** One event of the run, onto the job and out to the page. */
function relay(store: JobStore, record: JobRecord, event: RunEvent): void {
  const { job } = record
  switch (event.type) {
    case 'plan':
      // The root command's plan is the ladder; a child's plan stays its own.
      if (job.plan === null || event.depth <= 1) job.plan = event.steps
      store.emit(record, { type: 'plan', steps: event.steps })
      return
    case 'stage':
      job.stage = { id: event.id, label: event.label, detail: event.detail }
      job.tick = null
      job.line = progressLine(job.stage, null)
      store.emit(record, { type: 'stage', stage: job.stage })
      return
    case 'tick':
      job.tick = { done: event.done, total: event.total, unit: event.unit }
      job.line = progressLine(job.stage, job.tick)
      store.emit(record, { type: 'tick', tick: job.tick })
      return
    case 'line':
      store.emit(record, { type: 'line', text: event.text, level: event.level })
      return
    case 'text':
      store.emit(record, { type: 'text', text: event.text })
      return
    case 'prompt': {
      const prompt: PromptOnWire = { id: event.id, ...event.request }
      record.reply = event.reply
      job.line = `Needs you · ${promptTitle(prompt)}`
      store.emit(record, { type: 'prompt', prompt })
      void store.setState(record, 'needs-you')
      return
    }
    default:
      // Command boundaries are the log's business, not the page's.
      return
  }
}

const WHEN = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/

function parseStart(body: unknown, job: ImportJob): StartFields | string {
  const { readback } = job
  const b = (body ?? {}) as Record<string, unknown>
  const kind = typeof b.kind === 'string' ? b.kind : ''
  if (!KINDS.includes(kind as StartFields['kind'])) return `kind must be one of ${KINDS.join(', ')}`
  if (!readback.kinds.includes(kind as StartFields['kind'])) return `this file cannot be filed as a ${kind}`
  let when = typeof b.when === 'string' ? b.when.trim() : ''
  if (readback.source === 'document') {
    try {
      when = documentWorkWhen(when).toString()
    } catch (error) {
      return (error as Error).message
    }
    if (typeof b.summary !== 'string' || !b.summary.trim() || /[\r\n]/.test(b.summary))
      return 'Describe the work in one line.'
  } else if (!WHEN.test(when)) return 'when must be YYYY-MM-DD HH:MM'
  const category = b.category === 'Personal' ? 'Personal' : 'Professional'
  const journalType = typeof b.journalType === 'string' && b.journalType.trim() ? b.journalType.trim() : null
  if (kind === 'journal' && !journalType) return 'a journal needs a type'
  let audioSpeakers: Record<string, string> | undefined
  let to: string | undefined
  if (readback.source === 'imessage-audio') {
    const names = b.audioSpeakers as Record<string, unknown> | null | undefined
    const files = job.files ?? [job.file]
    if (
      !names ||
      typeof names !== 'object' ||
      Array.isArray(names) ||
      Object.keys(names).length !== files.length ||
      files.some(
        ({ name }) =>
          typeof names[name] !== 'string' ||
          !names[name].trim() ||
          names[name].length > 200 ||
          /[\r\n]/.test(names[name]),
      )
    )
      return "Enter who's speaking in each audio file."
    audioSpeakers = Object.fromEntries(files.map(({ name }) => [name, (names[name] as string).trim()]))
    // One clip is a message to someone; a conversation's other speakers say it themselves.
    if (files.length === 1) {
      const value = typeof b.to === 'string' ? b.to.trim() : ''
      if (!value || value.length > 200 || /[\r\n]/.test(value)) return 'Enter who the message is to.'
      to = value
    }
  }
  return {
    kind: kind as StartFields['kind'],
    when,
    ...(b.whenStated === true ? { whenStated: true } : {}),
    ...(b.dayStated === true ? { dayStated: true } : {}),
    category,
    journalType,
    fresh: b.fresh === true,
    ...(audioSpeakers ? { audioSpeakers } : {}),
    ...(to ? { to } : {}),
    ...(readback.source === 'document'
      ? { summary: (b.summary as string).trim(), body: typeof b.body === 'string' ? b.body : '' }
      : {}),
  }
}

export function createImportRoutes(options: ImportRoutesOptions): Hono {
  const store = new JobStore(options.dir)
  const loaded = store.load()
  const app = new Hono()
  const linkWrites = new Map<string, Promise<void>>()
  // A selection arriving as the command finishes must land before or after filing, never between reads.
  const withLinks = (id: string, action: () => Promise<void>): Promise<void> => {
    const work = (linkWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(action)
    linkWrites.set(id, work)
    void work
      .finally(() => {
        if (linkWrites.get(id) === work) linkWrites.delete(id)
      })
      .catch(() => {})
    return work
  }
  const saveLinks = async (record: JobRecord) => {
    const { job } = record
    const desired = job.links ?? []
    const linked = job.linked ?? []
    if (!job.result) return
    try {
      if (desired.length > 0 || linked.length > 0) {
        if (!options.links) throw new Error('Link saving is not available.')
        await options.links.update(
          job.result.file,
          desired,
          linked.filter((v) => !desired.includes(v)),
        )
      }
      job.linked = [...desired]
      job.linkError = null
    } catch (error) {
      // The record was filed. A failed metadata save must not rerun the import and create a duplicate.
      job.linkError = `The record was saved, but its links could not be saved. ${(error as Error).message}`
    }
    store.emit(record, { type: 'links', links: desired, error: job.linkError ?? null })
  }

  const notFound = (c: { json: (body: unknown, status: 404) => Response }) => c.json({ message: 'no such import' }, 404)

  // A file arrives: staged, read back, and — for a recording — listened to.
  // Text dragged onto the day arrives as a `text` field instead, and is
  // staged as a file of its own.
  app.post('/', async (c) => {
    await loaded
    const body = await c.req.raw.formData().catch(() => null)
    const filingDay = body?.get('day')
    if (filingDay !== null && filingDay !== undefined) {
      try {
        if (
          typeof filingDay !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(filingDay) ||
          new PlainDate(filingDay).toString() !== filingDay
        )
          throw new Error('Invalid day')
      } catch {
        return c.json({ message: 'Choose a valid day.' }, 400)
      }
    }
    const uploads = body?.getAll('file') ?? []
    if (!uploads.every((upload): upload is File => upload instanceof File)) {
      return c.json({ message: 'a file is required' }, 400)
    }
    const field = uploads.length === 0 ? body?.get('text') : null
    // Multipart sends every line break in a field as CRLF; the text had its own.
    const selection = typeof field === 'string' ? field.replace(/\r\n?/g, '\n') : null
    if (uploads.length === 0 && selection === null) return c.json({ message: 'a file is required' }, 400)
    if (selection !== null && !selection.trim()) return c.json({ message: 'the text is empty' }, 400)
    const empty = uploads.find((upload) => upload.size === 0)
    if (empty) return c.json({ message: uploads.length > 1 ? `${empty.name} is empty` : 'the file is empty' }, 400)
    const audioConversation =
      uploads.length > 0 && uploads.every((upload) => sourceOf(upload.name) === 'imessage-audio')
    if (uploads.length > 1 && !audioConversation && uploads.some((upload) => sourceOf(upload.name) !== 'image')) {
      return c.json(
        { message: 'Import screenshots together or .caf audio turns together. Other files need separate imports.' },
        400,
      )
    }

    const id = randomUUID()
    const dir = store.jobDir(id)
    await mkdir(dir, { recursive: true })
    const files: StagedFile[] = []
    const readbacks: ReadBack[] = []
    const modified = body?.getAll('lastModified') ?? []
    const names = new Set(['job.json'])
    try {
      if (selection !== null) {
        // No file clock: the proposal is the moment it was dropped.
        const bytes = new TextEncoder().encode(selection)
        await writeFile(path.join(dir, SELECTION_FILE), bytes, { flag: 'wx' })
        files.push({ name: SELECTION_FILE, size: bytes.byteLength, lastModified: null })
        readbacks.push(readSelection(selection))
      }
      for (const [index, upload] of uploads.entries()) {
        // The image command accepts comma-separated paths. Keep staged names
        // unambiguous, and never overwrite a same-named screenshot in the group.
        const base = safeAttachmentName(upload.name).replaceAll(',', '-')
        const ext = path.extname(base)
        let name = base
        let suffix = 2
        while (names.has(name.toLowerCase())) name = `${base.slice(0, base.length - ext.length)}-${suffix++}${ext}`
        names.add(name.toLowerCase())
        const filePath = path.join(dir, name)
        await writeFile(filePath, new Uint8Array(await upload.arrayBuffer()), { flag: 'wx' })
        const raw = typeof modified[index] === 'string' ? Number(modified[index]) : Number.NaN
        const lastModified = Number.isFinite(raw) && raw > 0 ? raw : null
        // message:new orders screenshots by their capture times, not upload times.
        if (lastModified !== null) await utimes(filePath, lastModified / 1000, lastModified / 1000)
        files.push({ name, size: upload.size, lastModified })
        readbacks.push(await options.read({ path: filePath, name, size: upload.size }))
      }
    } catch (error) {
      await rm(dir, { recursive: true, force: true })
      throw error
    }
    const file = files[0]
    const filePath = path.join(dir, file.name)
    const refused = readbacks.findIndex((readback) => readback.refusal !== null)
    const readback: ReadBack =
      files.length === 1
        ? readbacks[0]
        : {
            ...readbacks[0],
            summary: `${files.length} ${audioConversation ? 'audio turns' : 'screenshots'} → 1 message`,
            durationMinutes: audioConversation
              ? readbacks.every((item) => item.durationMinutes !== null)
                ? readbacks.reduce((total, item) => total + item.durationMinutes!, 0)
                : null
              : readbacks[0].durationMinutes,
            kinds: refused < 0 ? ['message'] : [],
            refusal: refused < 0 ? null : `${files[refused].name}: ${readbacks[refused].refusal}`,
          }
    const suggestedWhen =
      readback.source === 'document' && typeof filingDay === 'string' ? filingDay : options.suggestWhen(file, readback)
    // Keyed once, now: a filed run moves the upload on, and the key must outlive it.
    const kept =
      readback.refusal || readback.source === 'document' || (files.length > 1 && !audioConversation) || !options.record
        ? null
        : await options
            .record({
              path: filePath,
              key: null,
              ...(audioConversation ? { paths: files.map((item) => path.join(dir, item.name)) } : {}),
            })
            .catch(() => null)
    const job: ImportJob = {
      id,
      file,
      files,
      readback,
      listen: null,
      calendar: null,
      suggestedWhen,
      runKey: kept?.key ?? null,
      resume: kept?.resume ?? null,
      fields: null,
      state: readback.refusal ? 'failed' : 'new',
      plan: null,
      stage: null,
      tick: null,
      line: readback.refusal,
      title:
        files.length > 1 && !audioConversation ? `${files.length} screenshots` : titleOf(file, readback, suggestedWhen),
      result: null,
      error: readback.refusal,
      created: instantNow(),
    }
    const record = await store.add(job)

    if (!readback.refusal) {
      if (options.listen && readback.source === 'audio') {
        void options
          .listen(filePath, dir)
          .then(async (listen) => {
            if (!listen) return
            record.job.listen = listen
            store.emit(record, { type: 'listen', listen })
            await store.persist(record.job)
          })
          .catch(() => {})
      }
      // Each CAF clip is heard for its opening words, so the person names who
      // speaks in each by what it says, not by its file name.
      if (options.opening && audioConversation) {
        const clips = record.job.files ?? [record.job.file]
        const clipPaths = store.filePaths(record.job)
        for (const [index, staged] of clips.entries()) {
          void options
            .opening(clipPaths[index], dir)
            .then(async (opening) => {
              if (!opening) return
              staged.opening = opening
              if (record.job.file.name === staged.name) record.job.file.opening = opening
              store.emit(record, { type: 'opening', file: staged.name, opening })
              await store.persist(record.job)
            })
            .catch(() => {})
        }
      }
      if (options.calendar && !audioConversation) {
        void options
          .calendar(suggestedWhen, readback)
          .then(async (calendar) => {
            if (!calendar) return
            record.job.calendar = calendar
            store.emit(record, { type: 'calendar', calendar })
            await store.persist(record.job)
          })
          .catch(() => {})
      }
    }

    return c.json({ job: summarize(job), options: { journalTypes: options.journalTypes } }, 201)
  })

  app.get('/', async (c) => {
    await loaded
    // Finished imports leave at the next look, once their moment has passed.
    await store.sweep(options.now?.())
    return c.json({ imports: store.list().map(summarize) })
  })

  app.get('/:id', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    const { job } = record
    // A run that stopped left more to pick up than the upload showed; the
    // dialog opening again is when that is looked at.
    if (
      options.record &&
      job.readback.source !== 'document' &&
      ((job.files?.length ?? 1) === 1 || job.readback.source === 'imessage-audio') &&
      (job.state === 'failed' || job.state === 'cancelled') &&
      !job.readback.refusal
    ) {
      const kept = await options
        .record({
          path: store.filePath(job),
          key: job.runKey,
          ...(job.readback.source === 'imessage-audio' ? { paths: store.filePaths(job) } : {}),
        })
        .catch(() => null)
      if (kept) {
        job.runKey = kept.key
        job.resume = kept.resume
      }
    }
    return c.json({ job: summarize(job), options: { journalTypes: options.journalTypes } })
  })

  // Everything the job has said, then everything it says until it settles.
  app.get('/:id/events', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    return streamSSE(c, async (stream) => {
      let chain = Promise.resolve()
      const send = (event: { seq: number; type: string }) => {
        chain = chain.then(() =>
          stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) }),
        )
      }
      for (const event of record.events) send(event)
      if (!isSettled(record.job.state)) {
        await new Promise<void>((resolve) => {
          const off = store.subscribe(record, (event) => {
            send(event)
            if (event.type === 'state' && isSettled(event.state)) {
              off()
              resolve()
            }
          })
          stream.onAbort(() => {
            off()
            resolve()
          })
        })
      }
      await chain
    })
  })

  app.post('/:id/links', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    try {
      const body = await c.req.json()
      const values = linkValues(body.links)
      await withLinks(record.job.id, async () => {
        const added = values.filter((v) => !(record.job.links ?? []).includes(v))
        if (!options.links) throw new Error('Link saving is not available.')
        await options.links.validate(added)
        record.job.links = values
        record.job.linkError = null
        if (record.job.result) await saveLinks(record)
        else store.emit(record, { type: 'links', links: values, error: null })
        await store.persist(record.job)
      })
      return c.json({ job: summarize(record.job) })
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
  })

  // Start, with the answers the dialog collected. Again after a failure.
  app.post('/:id/start', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    const { job } = record
    if (job.state === 'running' || job.state === 'needs-you') {
      return c.json({ message: 'this import is already running' }, 409)
    }
    if (job.state === 'done') return c.json({ message: 'This import is already filed.' }, 409)
    if (job.readback.refusal) return c.json({ message: job.readback.refusal }, 400)
    const body = await c.req.json().catch(() => null)
    const fields = parseStart(body, job)
    if (typeof fields === 'string') return c.json({ message: fields }, 400)

    if (body?.fileOrder !== undefined) {
      const order: unknown = body.fileOrder
      const files = job.files ?? [job.file]
      if (
        job.readback.source !== 'imessage-audio' ||
        !Array.isArray(order) ||
        order.length !== files.length ||
        new Set(order).size !== files.length ||
        order.some((name) => !files.some((file) => file.name === name))
      ) {
        return c.json({ message: 'Turn order must include each uploaded audio file exactly once.' }, 400)
      }
      if (files.some((file, index) => file.name !== order[index])) {
        job.files = order.map((name) => files.find((file) => file.name === name)!)
        job.file = job.files[0]
        // Order is part of the conversation's identity. The pipeline and resume lookup recompute it.
        job.runKey = null
        job.resume = null
      }
    }

    if (job.readback.source === 'document' && job.fields) {
      // A retry finishes the capture already saved, even after a restart or cancellation.
      if (JSON.stringify({ ...fields, fresh: false }) !== JSON.stringify({ ...job.fields, fresh: false })) {
        return c.json({ message: 'Retry with the saved details, then edit the note after it finishes.' }, 400)
      }
    }
    job.fields = fields
    if (fields.summary) job.title = fields.summary
    job.plan = null
    job.stage = null
    job.tick = null
    if (job.readback.source !== 'document') {
      job.result = null
      job.linked = []
    }
    job.linkError = null
    job.error = null
    job.line = 'Starting…'
    record.events = record.events.filter((e) => e.type === 'listen' || e.type === 'opening' || e.type === 'calendar')
    await store.setState(record, 'running')
    const release = hold('import')

    const abort = new AbortController()
    record.abort = abort
    record.reply = null

    // The run is one stream; each event lands on the job and goes out to the page.
    void (async (): Promise<RunOutcome> => {
      const run = options.run(job, store.filePaths(job), abort.signal)
      let step = await run.next()
      while (!step.done) {
        if (record.job.state !== 'cancelled') relay(store, record, step.value)
        step = await run.next()
      }
      return step.value
    })()
      .then(
        (outcome): RunOutcome => outcome,
        (err): RunOutcome => ({ ok: false, message: err instanceof Error ? err.message : String(err) }),
      )
      .then(async (outcome) => {
        record.reply = null
        record.abort = null
        // A cancelled job ignores whatever its abandoned command came back with.
        if (record.job.state === 'cancelled') return
        record.job.tick = null
        if (outcome.ok) {
          await withLinks(record.job.id, async () => {
            record.job.result = outcome.file ? { file: outcome.file } : null
            await saveLinks(record)
            record.job.line = outcome.file ? `Filed · ${path.basename(outcome.file).replace(/\.md$/, '')}` : 'Filed'
            record.job.stage = null
            await store.setState(record, 'done')
          })
        } else {
          if (outcome.file) {
            await withLinks(record.job.id, async () => {
              record.job.result = { file: outcome.file! }
              await saveLinks(record)
            })
          }
          record.job.error = outcome.message
          record.job.line = outcome.message
          await store.setState(record, 'failed')
        }
      })
      .finally(release)

    return c.json({ job: summarize(job) })
  })

  // The browser's answer to a parked question.
  app.post('/:id/answer', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    const body = (await c.req.json().catch(() => null)) as { promptId?: unknown; answer?: unknown } | null
    const promptId = typeof body?.promptId === 'string' ? body.promptId : ''
    if (!promptId) return c.json({ message: 'promptId is required' }, 400)
    const waiting = record.events.findLast((e) => e.type === 'prompt')
    const open = waiting?.type === 'prompt' && waiting.prompt.id === promptId && record.reply !== null
    if (!open || !record.reply) return c.json({ message: 'no question is waiting with that id' }, 404)
    const reply = record.reply
    record.reply = null
    const answer = body?.answer ?? null
    reply(answer)
    // The answer rides along, so a page opened later can still say what was decided.
    store.emit(record, { type: 'answered', id: promptId, answer })
    record.job.line = progressLine(record.job.stage, record.job.tick) ?? 'Working…'
    await store.setState(record, 'running')
    return c.json({ job: summarize(record.job) })
  })

  app.post('/:id/cancel', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    if (record.job.state !== 'running' && record.job.state !== 'needs-you') {
      return c.json({ message: 'nothing is running' }, 409)
    }
    record.abort?.abort()
    record.abort = null
    record.reply = null
    record.job.error = 'Cancelled.'
    record.job.line = 'Cancelled.'
    await store.setState(record, 'cancelled')
    return c.json({ job: summarize(record.job) })
  })

  app.post('/:id/remove', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    if (record.job.state === 'running' || record.job.state === 'needs-you') {
      return c.json({ message: 'still running — cancel it first' }, 409)
    }
    await store.remove(record.job.id)
    return c.json({ ok: true })
  })

  return app
}
