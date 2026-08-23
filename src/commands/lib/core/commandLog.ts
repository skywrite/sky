import { beginEvent, logger } from '#shared/log.ts'

/**
 * Structured logging for command runs.
 *
 * Every command that runs without being typed at a prompt passes through
 * `CommandService.run()` — the heartbeat's headless dispatches, and every
 * command that calls another one, including an automating command whose whole
 * job is running others. This module owns what those runs look like in the
 * log, so the dispatcher does not have to carry logging policy.
 *
 * A run emits two records. The pair is the point: an end record alone cannot
 * distinguish a command still running from one that hung or was killed, and
 * `command-start` without a matching `command` is the fingerprint of both.
 *
 *   {"event":"command-start","command":"day:start","parent":"automate:daily","depth":0,"pid":123}
 *   {"event":"command","command":"day:start","parent":"automate:daily","depth":0,
 *    "outcome":"success","durationMs":412,"pid":123}
 *
 * `parent` is the command that asked for this one — absent for a headless
 * top-level dispatch — so any run can be attributed to whoever triggered it:
 *
 *   jq 'select(.parent == "automate:daily")' /tmp/sky/logs/*.jsonl
 *
 * Both records stay at info regardless of `depth`. Demoting nested runs to
 * debug would hide an automator's entire body of work by default, since all of
 * it is nested by definition.
 *
 * Records land in whichever stream the host process configured — `cli` for a
 * typed command's children, `service` for heartbeat dispatches — and are
 * dropped in processes that never configure logging, such as tests.
 *
 * The field vocabulary (`command`, `outcome`, `durationMs`, `pid`) is shared
 * with the process-level `invocation` event in command-runner.ts, so one query
 * matches a command however it was started. That event stays separate: it is
 * process-scoped, carries `tz` and `exitCode`, and fires from an exit hook.
 * Keep the shared field names aligned if either side changes.
 */

/** Outcomes a run can end in. Mirrors CommandResult's statuses. */
export type CommandOutcome = 'success' | 'fail' | 'error'

export interface CommandRunLog {
  /**
   * Close the run with whatever the command returned. A legacy command that
   * returns nothing counts as success, matching how command-runner reads an
   * absent result. A returned error is logged at error level exactly like a
   * thrown one — a command reporting failure by return value rather than by
   * throwing is a calling convention, not a lesser kind of failure.
   */
  finish(result?: { status?: string; message?: string; error?: unknown } | null): void
  /** Close the run that threw, recording the failure at error level. */
  fail(error: unknown): void
}

export interface CommandRunFields {
  /** Command name in colon form, e.g. `day:start`. */
  command: string
  /** The command that invoked this one; absent for a top-level dispatch. */
  parent?: string
  /** Composition depth — 0 for a top-level dispatch. */
  depth: number
}

/**
 * Open a command run: emits `command-start` immediately and returns the handle
 * that closes it. Callers must call exactly one of `finish` or `fail`; a run
 * that is never closed is precisely the hang signal, so nothing here tries to
 * be clever about closing it for them.
 */
export function beginCommandRun(fields: CommandRunFields): CommandRunLog {
  const log = logger('command')
  const shared = { ...fields, pid: process.pid }
  const span = beginEvent(log, 'command')
  span.set(shared)
  log.info('command-start', { event: 'command-start', ...shared })
  return {
    finish(result) {
      const outcome = toOutcome(result?.status)
      if (outcome === 'error') {
        span.fail(result?.error ?? new Error(result?.message ?? `${fields.command} failed`))
        return
      }
      span.emit(outcome)
    },
    fail(error) {
      span.fail(error)
    },
  }
}

/**
 * Run `body` as a logged command run. Callers get logging by wrapping rather
 * than by handling outcomes themselves, so nothing outside this module needs
 * to know that a returned error and a thrown one are the same severity.
 */
export async function withCommandRun<T extends { status?: string } | undefined>(
  fields: CommandRunFields,
  body: () => Promise<T>,
): Promise<T> {
  const run = beginCommandRun(fields)
  let result: T
  try {
    result = await body()
  } catch (error) {
    run.fail(error)
    throw error
  }
  run.finish(result)
  return result
}

/** Map a CommandResult status onto an outcome, defaulting to success. */
function toOutcome(status: string | undefined): CommandOutcome {
  return status === 'fail' || status === 'error' ? status : 'success'
}
