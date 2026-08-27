import { exists, outputFile, readTextFile, rename } from '#shared/fs/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { Trigger } from './trigger.ts'

/*
  What happened on each charter's last run.

  This lives outside the notebook on purpose. A charter is the person's pen;
  run-state is churn — a five-minute charter would rewrite its own frontmatter
  hundreds of times a day, and every rewrite would land in notebook git and in
  whatever is syncing the folder.

  Two stamps per run, and both are required:

    utc    an absolute instant, which is what an elapsed-time trigger compares
    clock  the reading on the charter's own clock, which is what a per-day
           trigger compares — notebook time with its extended hours, or a real
           wall clock in the charter's zone

  Keeping both is what makes a frame mix-up impossible rather than merely
  discouraged. A notebook-frame stamp compared against a UTC-frame now turns two
  minutes into four hours, and an elapsed-time charter that reads its stamp in
  the wrong frame fires on every single tick without ever complaining. So the
  store picks the field from the trigger rather than letting a caller choose.
*/

/**
 * Whether the run changed anything.
 *
 * A scheduled job that quietly does nothing is indistinguishable from a broken
 * one, so "ran and there was nothing to do" is recorded as its own result rather
 * than collapsing into success.
 */
export type RunOutcome = 'acted' | 'nothing' | 'failed'

export type AutomationRun = {
  utc: string
  clock: string
  outcome: RunOutcome
  /** The firing this run was for, e.g. "EVERY-WEEKDAY 09:30" */
  target?: string
  /** Minutes between that firing and the run actually starting */
  lateMinutes?: number
  /** Failure detail, or a short note about what was done */
  message?: string
}

type StateFile = {
  version: number
  runs: Record<string, AutomationRun>
}

const STATE_VERSION = 1

function format(dt: PlainDateTime): string {
  return `${dt.date} ${dt.time}`
}

function readStamp(value: string | undefined): PlainDateTime | undefined {
  if (!value) return undefined
  try {
    return PlainDateTime.fromString(value)
  } catch {
    // A corrupt stamp reads as never-run, which risks one extra run rather
    // than wedging the tick.
    return undefined
  }
}

export default class AutomationStateStore {
  readonly path: string
  /** Set when the file existed but could not be used; the store starts empty */
  readonly loadError: string | undefined
  private readonly runs: Map<string, AutomationRun>

  private constructor(path: string, runs: Map<string, AutomationRun>, loadError: string | undefined) {
    this.path = path
    this.runs = runs
    this.loadError = loadError
  }

  static async load(path: string): Promise<AutomationStateStore> {
    if (!(await exists(path))) return new AutomationStateStore(path, new Map(), undefined)

    try {
      const parsed = JSON.parse(await readTextFile(path)) as StateFile
      if (parsed?.version !== STATE_VERSION) {
        return new AutomationStateStore(path, new Map(), `unrecognized state version ${String(parsed?.version)}`)
      }
      return new AutomationStateStore(path, new Map(Object.entries(parsed.runs ?? {})), undefined)
    } catch (err) {
      return new AutomationStateStore(path, new Map(), err instanceof Error ? err.message : String(err))
    }
  }

  /** The stamp a trigger of this kind should be compared against */
  lastRunFor(name: string, trigger: Trigger): PlainDateTime | undefined {
    const run = this.runs.get(name)
    if (!run) return undefined
    return readStamp(trigger.kind === 'every' ? run.utc : run.clock)
  }

  /** The whole record, for reporting rather than deciding */
  last(name: string): AutomationRun | undefined {
    return this.runs.get(name)
  }

  names(): string[] {
    return [...this.runs.keys()].sort()
  }

  /** Both stamps are required, so a record can never carry only one frame */
  record(
    name: string,
    fields: {
      utc: PlainDateTime
      clock: PlainDateTime
      outcome: RunOutcome
      target?: string
      lateMinutes?: number
      message?: string
    },
  ): void {
    const run: AutomationRun = {
      utc: format(fields.utc),
      clock: format(fields.clock),
      outcome: fields.outcome,
    }
    if (fields.target !== undefined) run.target = fields.target
    if (fields.lateMinutes !== undefined) run.lateMinutes = fields.lateMinutes
    if (fields.message !== undefined) run.message = fields.message
    this.runs.set(name, run)
  }

  /**
   * Write through a temporary file and rename over the original. The service
   * exits on its own schedule, and a half-written state file would read as
   * corrupt and lose every charter's history at once.
   */
  async save(): Promise<void> {
    const runs: Record<string, AutomationRun> = {}
    for (const name of this.names()) {
      const run = this.runs.get(name)
      if (run) runs[name] = run
    }

    const contents = `${JSON.stringify({ version: STATE_VERSION, runs } satisfies StateFile, null, 2)}\n`
    const temp = `${this.path}.tmp`
    await outputFile(temp, contents)
    await rename(temp, this.path)
  }
}
