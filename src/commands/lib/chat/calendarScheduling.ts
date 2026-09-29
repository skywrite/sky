const UNSUPPORTED_ACTION =
  'Stop scheduling and explain the unsupported requirement to the user. Do not retry with different wording, drop the requirement, or split a recurring meeting into one-time events. Wait for the user to choose a supported alternative.'

export interface CalendarSchedulingRun {
  tool: string
  at: number
  input?: unknown
  output?: unknown
}

function resultOf(run: CalendarSchedulingRun): Record<string, unknown> {
  let value = run.output
  // Older recovered tool messages retain their JSON as text.
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

const SEND_FAILED_ACTION =
  'The calendar save failed. Stop scheduling in this turn. Keep the exact saved, edited draft and explain the failure. Do not send an older draft or prepare a replacement from conversation text. The user can review and retry the saved draft in its meeting card after fixing the problem. For an uncertain result, only check status; never retry the save.'

function failedSave(input: unknown, output: Record<string, unknown>): boolean {
  if (!input || typeof input !== 'object' || !('send' in input) || !input.send) return false
  return (
    output.success === false ||
    output.state === 'failed' ||
    output.state === 'uncertain' ||
    (Array.isArray(output.jobs) && output.jobs.some((job) => job?.state === 'failed' || job?.state === 'uncertain'))
  )
}

/** A new user turn cannot make drafts from an unsupported scheduling attempt safe to send. */
export function calendarDraftRefusal(
  runs: readonly CalendarSchedulingRun[],
  ids: readonly string[],
  at?: number,
): string | undefined {
  const preparations = runs.filter((run) => run.tool === 'calendar_schedule')
  if (at !== undefined && preparations.some((run) => run.at === at && failedSave(run.input, resultOf(run))))
    return SEND_FAILED_ACTION
  const unsupportedTurns = new Set(
    preparations.filter((run) => resultOf(run).status === 'unsupported').map((run) => run.at),
  )
  const blocked = new Set(
    preparations.filter((run) => unsupportedTurns.has(run.at)).map((run) => resultOf(run).draftId),
  )
  if (ids.some((id) => blocked.has(id)))
    return 'These drafts came from an unsupported scheduling request and cannot be sent. Prepare a fresh draft using the original request and the scheduler’s current capabilities. Recurring meetings now support one native series; never reuse or send the old separate-event batch.'
}

/** One user turn owns this queue; parallel preparations cannot race past an unsupported result. */
export class CalendarSchedulingTurn {
  private pending: Promise<unknown> = Promise.resolve()
  private unsupported = false
  private failedSave = false
  private receiptIds = new Set<string>()

  constructor(private history: () => readonly CalendarSchedulingRun[] = () => []) {}

  run(
    input: Record<string, unknown>,
    execute: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    // Receipt reads must remain available, including for an earlier uncertain save.
    if (typeof input.status === 'string' && input.status.trim()) return execute()
    const result = this.pending.then(async () => {
      if (this.unsupported) return { success: false, status: 'fail', retryable: false, error: UNSUPPORTED_ACTION }
      const ids = typeof input.send === 'string' ? input.send.split(',').map((id) => id.trim()) : []
      if (this.failedSave && !(ids.length && ids.every((id) => this.receiptIds.has(id))))
        return { success: false, status: 'fail', retryable: false, error: SEND_FAILED_ACTION }
      const refused = calendarDraftRefusal(this.history(), ids)
      if (refused) return { success: false, status: 'fail', retryable: false, error: refused }
      const output = await execute()
      if (failedSave(input, output)) {
        this.failedSave = true
        for (const job of Array.isArray(output.jobs) ? output.jobs : [output])
          if (job && typeof job.id === 'string' && typeof job.state === 'string') this.receiptIds.add(job.id)
        return { ...output, nextAction: SEND_FAILED_ACTION }
      }
      if (output.status !== 'unsupported') return output
      this.unsupported = true
      return { ...output, retryable: false, nextAction: UNSUPPORTED_ACTION }
    })
    this.pending = result.catch(() => {})
    return result
  }
}
