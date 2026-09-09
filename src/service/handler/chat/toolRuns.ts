import type { ModelMessage } from 'ai'
import { z } from 'zod'
import type { ToolExecutionEvent } from '#shared/models/Chat/ChatEngine/toolExecution.ts'
import { callSubject } from './callSubject.ts'
import type { ToolRun } from './mod.ts'

/** Retain inspectable data without echoing dedicated credential fields into the UI record. */
export function inspectablePayload(value: unknown): unknown {
  if (value === undefined) return undefined
  return JSON.parse(
    JSON.stringify(value, (key, child) =>
      /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie|client[_-]?secret)$/i.test(
        key,
      )
        ? '[redacted]'
        : child,
    ),
  )
}

export function recordToolExecution(runs: ToolRun[], at: number, event: ToolExecutionEvent): ToolRun {
  let run = runs.find((entry) => entry.callId === event.toolCallId)
  if (!run) {
    run = {
      tool: event.toolName,
      callId: event.toolCallId,
      at,
      started: event.type === 'tool-execution-start' ? event.started : event.finished,
      lines: [],
      status: null,
    }
    runs.push(run)
  }
  if (event.type === 'tool-execution-start') {
    run.phase = event.phase
    if (event.input !== undefined) {
      run.input = inspectablePayload(event.input)
      run.subject = callSubject(run.input)
    }
  } else {
    run.output = inspectablePayload(event.output)
    run.error = event.error
    const failed =
      event.output !== null &&
      typeof event.output === 'object' &&
      'success' in event.output &&
      event.output.success === false
    run.status = event.error || failed ? 'error' : (run.status ?? 'success')
    run.finished = event.finished
    run.phase = undefined
  }
  return run
}

const StoredRun = z.object({
  tool: z.string(),
  callId: z.string().optional(),
  at: z.number().int().nonnegative(),
  started: z.number(),
  lines: z.array(z.string()),
  status: z.enum(['success', 'fail', 'error']).nullable(),
  finished: z.number().optional(),
  summary: z.string().optional(),
  subject: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  phase: z.enum(['preparing', 'waiting', 'running']).optional(),
})

export function restoreToolRuns(value: unknown): ToolRun[] | undefined {
  const parsed = z.array(StoredRun).safeParse(value)
  if (!parsed.success) return undefined
  return parsed.data.map((run) =>
    run.status === null
      ? {
          ...run,
          status: 'error',
          phase: undefined,
          error: 'The service restarted before this tool reported completion.',
        }
      : run,
  )
}

/** Older recovery snapshots already carry exact calls/results in provider history. Times are unknown. */
export function toolRunsFromMessages(messages: ModelMessage[] = []): ToolRun[] {
  const runs: ToolRun[] = []
  let at = -1
  for (const message of messages) {
    if (message.role === 'user') at += 2
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === 'tool-call') {
        runs.push({
          tool: part.toolName,
          callId: part.toolCallId,
          at: Math.max(1, at),
          started: 0,
          lines: [],
          status: 'error',
          error: 'No completion result was retained for this call.',
          input: inspectablePayload(part.input),
          subject: callSubject(inspectablePayload(part.input)),
        })
      } else if (part.type === 'tool-result') {
        const run = runs.findLast((entry) => entry.callId === part.toolCallId)
        if (!run) continue
        const output = part.output
        run.status = 'success'
        run.error = undefined
        run.output = inspectablePayload('value' in output ? output.value : output)
        if (
          output.type === 'error-text' ||
          output.type === 'error-json' ||
          (run.output && typeof run.output === 'object' && 'success' in run.output && run.output.success === false)
        )
          run.status = 'error'
      }
    }
  }
  return runs
}
