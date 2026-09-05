import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { PlanStep } from '#commands/lib/output/OutputHandler.ts'
import type { PromptRequest } from '#commands/lib/prompt/Prompter.ts'
import type { ImportKind, ReadBack } from './readback.ts'

export type ImportState = 'new' | 'running' | 'needs-you' | 'done' | 'failed' | 'cancelled'

export interface StagedFile {
  /** The name the file arrived with */
  name: string
  size: number
  /** The file's own modified time from the browser, ms since the epoch; null when it sent none */
  lastModified: number | null
}

/** The first minute of a recording, heard: the opening words and a guessed kind. */
export interface Listen {
  kind: ImportKind
  opening: string
  /** "Sounds like a meeting recap." */
  guess: string
}

/** A calendar event near the file's time. */
export interface CalendarMatch {
  title: string
  /** HH:MM */
  start: string
  end: string | null
  who: string[]
  /** "matches" a transcript's start, or "just after" a memo's recording time */
  relation: 'matches' | 'just-after'
}

/** What a run of the file would pick up at: the pipeline's record from an earlier run. */
export interface Resume {
  /** The step, in the ladder's words: "Writing it up" */
  step: string
  /** Notebook time the earlier run began, YYYY-MM-DD HH:MM */
  started: string
}

export interface StartFields {
  kind: ImportKind
  /** Notebook time, YYYY-MM-DD HH:MM — the date decides the day folder */
  when: string
  /** Explicitly chosen, including a drop on a calendar slot whose time matches the proposal */
  whenStated?: boolean
  category: 'Professional' | 'Personal'
  journalType: string | null
  /** Start over: forget the earlier run's record */
  fresh: boolean
}

/** The step a command says it is on, in its own words. */
export interface Stage {
  id: string
  label: string
  detail: string | null
}

/** A real count inside the current step. */
export interface Tick {
  done: number
  total: number | null
  unit: string | null
}

export interface ImportJob {
  id: string
  file: StagedFile
  readback: ReadBack
  listen: Listen | null
  calendar: CalendarMatch | null
  /** The when sky proposes, from the file's time and length */
  suggestedWhen: string
  /** The pipeline's record key for the file, from its bytes at upload; null when the host keeps none */
  runKey: string | null
  /** The earlier run to pick up, when there is one */
  resume: Resume | null
  fields: StartFields | null
  state: ImportState
  /** The steps the command announced for this run, in the words a person reads */
  plan: PlanStep[] | null
  /** The step running now */
  stage: Stage | null
  tick: Tick | null
  /** The row's second line: the step and its count, or what it is waiting for, or how it ended */
  line: string | null
  title: string
  /** What was filed, relative to the notebook root */
  result: { file: string } | null
  error: string | null
  /** ISO, when the file arrived */
  created: string
}

export type PromptOnWire = { id: string } & PromptRequest

export type ImportEventBody =
  | { type: 'listen'; listen: Listen }
  | { type: 'calendar'; calendar: CalendarMatch }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'stage'; stage: Stage }
  | { type: 'tick'; tick: Tick }
  | { type: 'line'; text: string; level: 'log' | 'error' }
  | { type: 'text'; text: string }
  | { type: 'prompt'; prompt: PromptOnWire }
  | { type: 'answered'; id: string; answer: unknown }
  | { type: 'state'; state: ImportState; line: string | null; result: { file: string } | null; error: string | null }

export type ImportEvent = ImportEventBody & { seq: number }

const SETTLED: ReadonlySet<ImportState> = new Set(['done', 'failed', 'cancelled'])

export function isSettled(state: ImportState): boolean {
  return SETTLED.has(state)
}

/** The job as a list row and as the dialog's data. */
export function summarize(job: ImportJob): Omit<ImportJob, 'file'> & { file: StagedFile; when: string } {
  const at = new Date(job.created)
  const when = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return { ...job, when }
}

/** "Checking names · 3 to check", "Filing · 2 of 5 action items" */
export function progressLine(stage: Stage | null, tick: Tick | null): string | null {
  if (!stage) return null
  const count = tick
    ? `${tick.done}${tick.total !== null ? ` of ${tick.total}` : ''}${tick.unit ? ` ${tick.unit}` : ''}`
    : null
  return [stage.label, stage.detail, count].filter((p): p is string => Boolean(p)).join(' · ')
}

// -----------------------------------------------------------------------------
// The store: memory first, a job.json beside each upload
// -----------------------------------------------------------------------------

const JOB_FILE = 'job.json'

export interface JobRecord {
  job: ImportJob
  events: ImportEvent[]
  /** The answer to the question the command is waiting on, when it is waiting */
  reply: ((answer: unknown) => void) | null
  /** The running command's cancel */
  abort: AbortController | null
  listeners: Set<(event: ImportEvent) => void>
  seq: number
  /** Monotonic ordering for the list */
  order: number
}

export class JobStore {
  private readonly records = new Map<string, JobRecord>()
  /** One write at a time per job, in order — two states racing for job.json would tear it. */
  private readonly writes = new Map<string, Promise<void>>()
  private tick = 0

  constructor(readonly dir: string) {}

  /** Every job.json under the imports directory; a job that was mid-way when the service died is failed now. */
  async load(): Promise<void> {
    let entries: string[]
    try {
      entries = (await readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return
    }
    for (const id of entries) {
      let job: ImportJob
      try {
        job = JSON.parse(await readFile(path.join(this.dir, id, JOB_FILE), 'utf8')) as ImportJob
      } catch {
        // A directory without a readable job.json is not a job.
        continue
      }
      if (job.state === 'running' || job.state === 'needs-you') {
        job.state = 'failed'
        job.error = 'Sky restarted while this was running. The file is still here.'
        job.line = job.error
        // The job is known either way; the write only records what a restart already knows.
        await this.persist(job).catch(() => {})
      }
      this.records.set(id, {
        job,
        events: [],
        reply: null,
        abort: null,
        listeners: new Set(),
        seq: 0,
        order: ++this.tick,
      })
    }
  }

  jobDir(id: string): string {
    return path.join(this.dir, id)
  }

  /** Where the upload itself lives. */
  filePath(job: ImportJob): string {
    return path.join(this.jobDir(job.id), job.file.name)
  }

  async add(job: ImportJob): Promise<JobRecord> {
    const record: JobRecord = {
      job,
      events: [],
      reply: null,
      abort: null,
      listeners: new Set(),
      seq: 0,
      order: ++this.tick,
    }
    this.records.set(job.id, record)
    await this.persist(job)
    return record
  }

  get(id: string): JobRecord | undefined {
    return this.records.get(id)
  }

  /** Newest activity first. */
  list(): ImportJob[] {
    return [...this.records.values()].sort((a, b) => b.order - a.order).map((r) => r.job)
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
    await rm(this.jobDir(id), { recursive: true, force: true })
  }

  emit(record: JobRecord, event: ImportEventBody): ImportEvent {
    const full: ImportEvent = { ...event, seq: ++record.seq }
    record.events.push(full)
    record.order = ++this.tick
    for (const listener of record.listeners) listener(full)
    return full
  }

  /** A state change: recorded on the job, told to listeners, written to disk. */
  async setState(record: JobRecord, state: ImportState, patch: Partial<ImportJob> = {}): Promise<void> {
    Object.assign(record.job, patch, { state })
    this.emit(record, {
      type: 'state',
      state,
      line: record.job.line,
      result: record.job.result,
      error: record.job.error,
    })
    await this.persist(record.job)
  }

  subscribe(record: JobRecord, listener: (event: ImportEvent) => void): () => void {
    record.listeners.add(listener)
    return () => record.listeners.delete(listener)
  }

  persist(job: ImportJob): Promise<void> {
    const snapshot = JSON.stringify(job, null, 2)
    const previous = this.writes.get(job.id) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(async () => {
        const dir = this.jobDir(job.id)
        await mkdir(dir, { recursive: true })
        // A name of its own per write: a stale writer must never rename this one away.
        const temp = path.join(dir, `${JOB_FILE}.${Math.random().toString(36).slice(2, 8)}.tmp`)
        await writeFile(temp, snapshot)
        await rename(temp, path.join(dir, JOB_FILE))
      })
    this.writes.set(job.id, next)
    return next
  }
}
