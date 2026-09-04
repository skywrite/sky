/**
 * Meeting from a file — the service's side of dropping a transcript, a
 * recording or a screenshot on the day.
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
import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { RunEvent } from '#commands/lib/core/runCommand.ts'
import { safeAttachmentName } from '../attachments/mod.ts'
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
import { KINDS, type ReadBack } from './readback.ts'

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

export type RunOutcome = { ok: true; file: string | null } | { ok: false; message: string }

export interface ImportRoutesOptions {
  /** Where uploads and their job files live */
  dir: string
  /** What a staged file is, read locally before anything runs */
  read: (file: { path: string; name: string; size: number }) => Promise<ReadBack>
  /** The when sky proposes for a file, notebook time, YYYY-MM-DD HH:MM */
  suggestWhen: (file: StagedFile, readback: ReadBack) => string
  /** The first minute of a recording, heard; absent or null when it cannot be */
  listen?: (filePath: string, jobDir: string) => Promise<Listen | null>
  /** A calendar event near the suggested when; absent or null when there is none */
  calendar?: (when: string, readback: ReadBack) => Promise<CalendarMatch | null>
  /**
   * The pipeline's run record for the file: its key, from the file's bytes
   * unless one is already known, and what an earlier run left to pick up.
   * Absent when the host keeps no records.
   */
  record?: (file: { path: string; key: string | null }) => Promise<{ key: string; resume: Resume | null }>
  /**
   * Run the import as the person asked: the door command with the job's
   * fields, as one stream of what it reports and asks, ending in how it went.
   * The signal is the person's cancel.
   */
  run: (job: ImportJob, filePath: string, signal: AbortSignal) => AsyncGenerator<RunEvent, RunOutcome, void>
  /** The journal types the dialog offers */
  journalTypes: string[]
}

/** "Voice memo 9:14", "Screenshot 7:44", or the file's name without its extension. */
function titleOf(file: StagedFile, readback: ReadBack, when: string): string {
  const time = when.slice(11).replace(/^0/, '')
  if (readback.source === 'audio') return `Voice memo ${time}`
  if (readback.source === 'image') return `Screenshot ${time}`
  return file.name.replace(/\.[^.]+$/, '')
}

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

function parseStart(body: unknown, readback: ReadBack): StartFields | string {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = typeof b.kind === 'string' ? b.kind : ''
  if (!KINDS.includes(kind as StartFields['kind'])) return 'kind must be one of meeting, journal, note, message, event'
  if (!readback.kinds.includes(kind as StartFields['kind'])) return `this file cannot be filed as a ${kind}`
  const when = typeof b.when === 'string' ? b.when.trim() : ''
  if (!WHEN.test(when)) return 'when must be YYYY-MM-DD HH:MM'
  const category = b.category === 'Personal' ? 'Personal' : 'Professional'
  const journalType = typeof b.journalType === 'string' && b.journalType.trim() ? b.journalType.trim() : null
  if (kind === 'journal' && !journalType) return 'a journal needs a type'
  return { kind: kind as StartFields['kind'], when, category, journalType, fresh: b.fresh === true }
}

export function createImportRoutes(options: ImportRoutesOptions): Hono {
  const store = new JobStore(options.dir)
  const loaded = store.load()
  const app = new Hono()

  const notFound = (c: { json: (body: unknown, status: 404) => Response }) => c.json({ message: 'no such import' }, 404)

  // A file arrives: staged, read back, and — for a recording — listened to.
  app.post('/', async (c) => {
    await loaded
    const body = await c.req.parseBody().catch(() => null)
    const upload = body?.file
    if (!(upload instanceof File)) return c.json({ message: 'a file is required' }, 400)
    if (upload.size === 0) return c.json({ message: 'the file is empty' }, 400)

    const id = randomUUID()
    const name = safeAttachmentName(upload.name)
    const dir = store.jobDir(id)
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, name)
    await writeFile(filePath, new Uint8Array(await upload.arrayBuffer()))

    const lastModifiedRaw = typeof body?.lastModified === 'string' ? Number(body.lastModified) : Number.NaN
    const file: StagedFile = {
      name,
      size: upload.size,
      lastModified: Number.isFinite(lastModifiedRaw) && lastModifiedRaw > 0 ? lastModifiedRaw : null,
    }
    const readback = await options.read({ path: filePath, name, size: upload.size })
    const suggestedWhen = options.suggestWhen(file, readback)
    // Keyed once, now: a filed run moves the upload on, and the key must outlive it.
    const kept =
      readback.refusal || !options.record ? null : await options.record({ path: filePath, key: null }).catch(() => null)
    const job: ImportJob = {
      id,
      file,
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
      title: titleOf(file, readback, suggestedWhen),
      result: null,
      error: readback.refusal,
      created: new Date().toISOString(),
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
      if (options.calendar) {
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
    return c.json({ imports: store.list().map(summarize) })
  })

  app.get('/:id', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    const { job } = record
    // A run that stopped left more to pick up than the upload showed; the
    // dialog opening again is when that is looked at.
    if (options.record && (job.state === 'failed' || job.state === 'cancelled') && !job.readback.refusal) {
      const kept = await options.record({ path: store.filePath(job), key: job.runKey }).catch(() => null)
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

  // Start, with the answers the dialog collected. Again after a failure.
  app.post('/:id/start', async (c) => {
    await loaded
    const record = store.get(c.req.param('id'))
    if (!record) return notFound(c)
    const { job } = record
    if (job.state === 'running' || job.state === 'needs-you') {
      return c.json({ message: 'this import is already running' }, 409)
    }
    if (job.readback.refusal) return c.json({ message: job.readback.refusal }, 400)
    const fields = parseStart(await c.req.json().catch(() => null), job.readback)
    if (typeof fields === 'string') return c.json({ message: fields }, 400)

    job.fields = fields
    job.plan = null
    job.stage = null
    job.tick = null
    job.result = null
    job.error = null
    job.line = 'Starting…'
    record.events = record.events.filter((e) => e.type === 'listen' || e.type === 'calendar')
    await store.setState(record, 'running')

    const abort = new AbortController()
    record.abort = abort
    record.reply = null

    // The run is one stream; each event lands on the job and goes out to the page.
    void (async (): Promise<RunOutcome> => {
      const run = options.run(job, store.filePath(job), abort.signal)
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
          record.job.result = outcome.file ? { file: outcome.file } : null
          record.job.line = outcome.file ? `Filed · ${path.basename(outcome.file).replace(/\.md$/, '')}` : 'Filed'
          record.job.stage = null
          await store.setState(record, 'done')
        } else {
          record.job.error = outcome.message
          record.job.line = outcome.message
          await store.setState(record, 'failed')
        }
      })

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
