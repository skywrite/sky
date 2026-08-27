import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import AutomationStateStore, { type RunOutcome } from '#shared/models/Automation/state.ts'
import { dueFiring, resolveNow } from '#shared/models/Automation/trigger.ts'
import type { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

/*
  One pass over the declared automations: read the charters, ask each whether it
  owes a run, run the ones that do, and record what happened.

  Invocation is injected rather than reaching for CommandService here. The pass
  is then testable without running real commands, and the decision about how a
  command's result maps onto acted / nothing-to-do / failed stays with the
  caller that knows the command, instead of being guessed at from a status code.

  Runs are sequential. Two automations writing the notebook at once is a worse
  problem than a slow pass, and the tick that drives this already refuses to
  start a second pass while one is in flight.

  Which is also why a run cannot be allowed to hang: the tick's own guard means
  one wedged command stops every automation for as long as the service lives. A
  run that overruns is abandoned and recorded as failed. Abandoned rather than
  cancelled, because a command in flight cannot be called back — it may still
  finish later, and its result is simply ignored.
*/

/** Long enough for a slow sync, short enough that a wedge is not permanent */
const DEFAULT_TIMEOUT_MS = 10 * 60_000

type Abandoned = { timedOut: true }

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | Abandoned> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // Promise.race attaches handlers to both sides immediately, so a rejection
  // arriving after the timeout has won is still considered handled.
  const abandon = new Promise<Abandoned>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms)
  })
  try {
    return await Promise.race([work, abandon])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** What a run needs to know about the firing it is answering */
export type TriggerContext = {
  /** The firing as written, e.g. "EVERY-WEEKDAY 09:30" or "every 5m" */
  target: string
  /** The clock the charter reads: 'local', 'utc', or a zone name */
  frame: string
  /** The charter's own clock at the moment of the run */
  now: PlainDateTime
  /**
   * Minutes between the firing being owed and the run starting. A charter that
   * reports a market open four hours late has to be able to say so rather than
   * present stale data as fresh.
   */
  lateMinutes: number
}

export type InvokeResult = { outcome: RunOutcome; message?: string }

export type Invoke = (job: {
  name: string
  run: string
  args: Record<string, unknown>
  context: TriggerContext
}) => Promise<InvokeResult>

export type RanEntry = { name: string; run: string; outcome: RunOutcome; lateMinutes: number; message?: string }
export type StoodDownEntry = { name: string; reason: 'paused' | 'expired' }

export type PassSummary = {
  /** Charters that loaded and were considered */
  considered: number
  ran: RanEntry[]
  stoodDown: StoodDownEntry[]
  /** Loaded, active, and simply not owed anything right now */
  notDue: string[]
  /** Charters that could not be read, by path */
  charterErrors: { path: string; error: string }[]
  /** Frontmatter keys nothing reads — a misspelled tz: hides in here */
  unknownKeys: { name: string; keys: string[] }[]
  /** Set when previous run-state could not be used; every charter reads as never-run */
  stateError?: string
}

function frameOf(trigger: { kind: string; zone?: string }): string {
  if (trigger.kind === 'every') return 'utc'
  return trigger.zone ?? 'local'
}

export type RunDueOptions = {
  /** Directory of charter markdown files */
  dir: string
  /** Where run-state is kept — outside the notebook */
  statePath: string
  /** The instant this pass runs at */
  systemNow: ZonedDateTime
  invoke: Invoke
  /** How long a single run may take before it is abandoned */
  timeoutMs?: number
}

export default async function runDueAutomations(options: RunDueOptions): Promise<PassSummary> {
  const { dir, statePath, systemNow, invoke, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  const { byName, errors } = await loadAutomationDir(dir)
  const state = await AutomationStateStore.load(statePath)

  // The absolute stamp is the same for every charter in the pass; each
  // charter's own-frame stamp is whatever clock it reads.
  const utcNow = systemNow.toUTC().normalize().plainDateTime
  const localToday = systemNow.normalize().plainDateTime.plainDate

  const summary: PassSummary = {
    considered: byName.size,
    ran: [],
    stoodDown: [],
    notDue: [],
    charterErrors: errors,
    unknownKeys: [],
    stateError: state.loadError,
  }

  for (const [name, { automation }] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    if (automation.unknownKeys.length) {
      summary.unknownKeys.push({ name, keys: automation.unknownKeys })
    }

    if (!automation.isRunnable(localToday)) {
      summary.stoodDown.push({ name, reason: automation.status === 'paused' ? 'paused' : 'expired' })
      continue
    }

    const { trigger } = automation
    const now = resolveNow(trigger, systemNow)
    const firing = dueFiring(trigger, { now, lastRun: state.lastRunFor(name, trigger) })
    if (!firing) {
      summary.notDue.push(name)
      continue
    }

    const [nowHours, nowMinutes] = now.time.split(':').map(Number)
    const context: TriggerContext = {
      target: firing.target,
      frame: frameOf(trigger),
      now,
      lateMinutes: Math.max(0, nowHours * 60 + nowMinutes - firing.fireMinutes),
    }

    let result: InvokeResult
    try {
      const settled = await withTimeout(
        invoke({ name, run: automation.run, args: automation.args, context }),
        timeoutMs,
      )
      result =
        'timedOut' in settled
          ? { outcome: 'failed', message: `abandoned after ${Math.round(timeoutMs / 60_000)}m without finishing` }
          : settled
    } catch (err) {
      // A command that throws still has to leave a stamp, or it is retried on
      // every tick for as long as it keeps throwing.
      result = { outcome: 'failed', message: err instanceof Error ? err.message : String(err) }
    }

    state.record(name, {
      utc: utcNow,
      clock: now,
      outcome: result.outcome,
      target: context.target,
      lateMinutes: context.lateMinutes,
      message: result.message,
    })

    const entry: RanEntry = {
      name,
      run: automation.run,
      outcome: result.outcome,
      lateMinutes: context.lateMinutes,
    }
    if (result.message !== undefined) entry.message = result.message
    summary.ran.push(entry)
  }

  // Nothing ran, nothing to write — a quiet tick leaves the file alone.
  if (summary.ran.length) await state.save()

  return summary
}
