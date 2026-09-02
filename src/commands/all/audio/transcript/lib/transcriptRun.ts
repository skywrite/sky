/**
 * The run record: what the transcript pipeline has already produced for a
 * source file, kept so a run that failed, was cancelled, or was cut off by
 * a restart picks up where it stopped instead of paying for the same work
 * twice.
 *
 * One directory per source file under DIR_STATE/transcript/runs, named by
 * the sha256 of the file's bytes — a rename, a move, or the same recording
 * dropped again all find it; an edited or re-exported file does not. Each
 * expensive stage writes its result as one JSON file when it finishes and
 * reads it first when it starts: the raw transcription, the analysis and
 * the names review, the write-up and its extracted fields, the filed
 * document. Whoever started the run deletes the record when it finishes —
 * nothing outlives a completed run — and `--fresh` deletes it up front.
 *
 * A record untouched for STALE_DAYS is deleted on open rather than picked
 * up: the prompts and the models move, and a month-old checkpoint is not
 * the run the person is asking for.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_STATE } from '#config'
import type { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export const RUNS_DIR = path.join(DIR_STATE, 'transcript', 'runs')

/** Days without a write after which a record is forgotten instead of resumed */
export const STALE_DAYS = 30

const MANIFEST = 'run.json'

// -----------------------------------------------------------------------------
// What each stage keeps
// -----------------------------------------------------------------------------

/** The words as transcribed, before any correction */
export interface RawStage {
  text: string
  durationSeconds?: number
  language?: string
}

/** The analysis as the model returned it; the reader validates the shape it expects */
export interface AnalysisStage {
  analysis: unknown
}

/** One answer from the names review, as the cleaner applies it */
export interface ReviewCorrection {
  issueIndex: number
  originalText: string
  correction: string
  occurrences: number
  action: 'accept' | 'custom' | 'skip'
}

export interface ReviewStage {
  corrections: ReviewCorrection[]
}

export interface WriteupStage {
  summary: string
}

/** The fields as they stand — extracted, then as corrected by each round of the check */
export interface ExtractStage {
  title: string
  time: string | null
  durationMinutes: number | null
  medium: string | null
  who: string[]
  rel: string[]
  from: string | null
  to: string | null
  actionItems: unknown
}

/** The document on disk, and what was still to do after it */
export interface FiledStage {
  /** Absolute path of the filed document */
  file: string
  actionItems: unknown
  routeActions: boolean
}

export interface StageData {
  raw: RawStage
  analysis: AnalysisStage
  review: ReviewStage
  writeup: WriteupStage
  extract: ExtractStage
  filed: FiledStage
}

export type RunStage = keyof StageData

/** In the order the pipeline reaches them */
export const STAGES: RunStage[] = ['raw', 'analysis', 'review', 'writeup', 'extract', 'filed']

export interface Checkpoint<S extends RunStage> {
  /** Notebook time the stage finished, YYYY-MM-DD HH:MM */
  at: string
  data: StageData[S]
}

/** What a run would pick up at, and when it began */
export interface Resume {
  /** The step, in the ladder's words: "Writing it up" */
  step: string
  /** Notebook time, YYYY-MM-DD HH:MM */
  started: string
}

interface Manifest {
  version: 1
  /** The source file's name, for whoever reads the directory by hand */
  source: string
  started: string
}

interface Envelope {
  version: 1
  at: string
  data: unknown
}

export interface TranscriptRunOptions {
  /** Where the records live; the state directory unless a test says otherwise */
  dir?: string
  /** The notebook's clock, spelled YYYY-MM-DD HH:MM */
  now: () => string
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** The sha256 of a file's bytes, streamed: a screen recording can be gigabytes. */
export async function sha256Of(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Uint8Array)
  return hash.digest('hex')
}

/** The step after the stages done, in the ladder's words; null when nothing is done */
export function nextStep(done: RunStage[]): string | null {
  const has = (stage: RunStage) => done.includes(stage)
  if (has('filed')) return 'Action items'
  if (has('extract')) return 'Checking the write-up'
  if (has('writeup') || has('review')) return 'Writing it up'
  if (has('analysis') || has('raw')) return 'Checking names'
  return null
}

/** "00:06" when the stamp is today by the clock given, else the whole stamp */
export function clockLabel(stamp: string, now: string): string {
  return stamp.slice(0, 10) === now.slice(0, 10) ? stamp.slice(11) : stamp
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** A write that lands whole or not at all: a crash mid-write must not leave half a checkpoint. */
async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n')
  await rename(temp, filePath)
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Envelope).version === 1 &&
    typeof (value as Envelope).at === 'string' &&
    'data' in value
  )
}

function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Manifest).version === 1 &&
    typeof (value as Manifest).started === 'string'
  )
}

/** The record options a command builds from its context: the notebook's clock. */
export function runOptionsFor(context: { notebookNow: ZonedDateTime }): TranscriptRunOptions {
  return { now: () => context.notebookNow.plainDateTime.toString() }
}

// -----------------------------------------------------------------------------
// The record
// -----------------------------------------------------------------------------

export class TranscriptRun {
  readonly dir: string

  private constructor(
    readonly key: string,
    private readonly source: string,
    private readonly now: () => string,
    root: string,
  ) {
    this.dir = path.join(root, key)
  }

  /** The record for a source file, keyed by its bytes. */
  static async forFile(filePath: string, options: TranscriptRunOptions): Promise<TranscriptRun> {
    return TranscriptRun.open(await sha256Of(filePath), options, path.basename(filePath))
  }

  /** The record a parent passed down when it did, else the file's own. */
  static async resolve(
    key: string | undefined,
    filePath: string,
    options: TranscriptRunOptions,
  ): Promise<TranscriptRun> {
    return key ? TranscriptRun.open(key, options, path.basename(filePath)) : TranscriptRun.forFile(filePath, options)
  }

  /** The record for a key a parent already computed and passed down. */
  static async open(key: string, options: TranscriptRunOptions, source = ''): Promise<TranscriptRun> {
    const run = new TranscriptRun(key, source, options.now, options.dir ?? RUNS_DIR)
    if (await run.stale()) await run.clear()
    return run
  }

  private manifestPath(): string {
    return path.join(this.dir, MANIFEST)
  }

  private stagePath(stage: RunStage): string {
    return path.join(this.dir, `${stage}.json`)
  }

  /** Untouched for longer than STALE_DAYS — every write touches the manifest. */
  private async stale(): Promise<boolean> {
    try {
      const { mtimeMs } = await stat(this.manifestPath())
      return Date.now() - mtimeMs > STALE_DAYS * 24 * 60 * 60 * 1000
    } catch {
      return false
    }
  }

  /** Notebook time the run began, or null when nothing has been kept */
  async started(): Promise<string | null> {
    const manifest = await readJson(this.manifestPath())
    return isManifest(manifest) ? manifest.started : null
  }

  /** The stages kept so far, in pipeline order */
  async done(): Promise<RunStage[]> {
    const present: RunStage[] = []
    for (const stage of STAGES) {
      try {
        await stat(this.stagePath(stage))
        present.push(stage)
      } catch {
        // not kept
      }
    }
    return present
  }

  /** What a run of this file would pick up at; null when it would start from nothing */
  async resume(): Promise<Resume | null> {
    const step = nextStep(await this.done())
    const started = await this.started()
    return step && started ? { step, started } : null
  }

  async get<S extends RunStage>(stage: S): Promise<Checkpoint<S> | null> {
    const value = await readJson(this.stagePath(stage))
    if (!isEnvelope(value)) return null
    return { at: value.at, data: value.data as StageData[S] }
  }

  async put<S extends RunStage>(stage: S, data: StageData[S]): Promise<void> {
    const at = this.now()
    const manifest = await readJson(this.manifestPath())
    const started = isManifest(manifest) ? manifest.started : at
    const source = isManifest(manifest) && manifest.source ? manifest.source : this.source
    // The manifest is rewritten on every checkpoint so its mtime is the run's last activity.
    await writeJson(this.manifestPath(), { version: 1, source, started } satisfies Manifest)
    await writeJson(this.stagePath(stage), { version: 1, at, data } satisfies Envelope)
  }

  /** Forget the run: the directory and everything in it. */
  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }
}

/** What a run keyed so would pick up at, before anything runs; null when nothing is kept. */
export async function peekTranscriptRun(key: string, options: { dir?: string } = {}): Promise<Resume | null> {
  const run = await TranscriptRun.open(key, { ...options, now: () => '' })
  return run.resume()
}

/** Forget a run by its key — the door that filed the document calls this last. */
export async function clearTranscriptRun(key: string, options: { dir?: string } = {}): Promise<void> {
  await rm(path.join(options.dir ?? RUNS_DIR, key), { recursive: true, force: true })
}
