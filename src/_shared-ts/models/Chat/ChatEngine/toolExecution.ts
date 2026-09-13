import type { TextStreamPart, ToolSet } from 'ai'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export type ToolExecutionEvent =
  | {
      type: 'tool-execution-start'
      toolCallId: string
      toolName: string
      input?: unknown
      started: number
      phase: 'preparing' | 'waiting' | 'running'
    }
  | {
      type: 'tool-execution-end'
      toolCallId: string
      toolName: string
      output?: unknown
      error?: string
      finished: number
    }

type Executable = { execute?: (...args: never[]) => unknown }

/** One lifecycle per call, shared by local execution and provider stream events. */
export class ToolProgress {
  private active = new Map<string, Extract<ToolExecutionEvent, { type: 'tool-execution-start' }>>()
  private completed = new Set<string>()

  constructor(private emit: (event: ToolExecutionEvent) => void) {}

  report = (event: ToolExecutionEvent): void => {
    if (this.completed.has(event.toolCallId)) return
    if (event.type === 'tool-execution-end') {
      this.active.delete(event.toolCallId)
      this.completed.add(event.toolCallId)
    } else {
      const previous = this.active.get(event.toolCallId)
      // SDK stream callbacks can trail the executor. Never move a running call back to preparation.
      if (previous?.phase === 'running' && event.phase !== 'running') return
      if (previous?.phase === event.phase && event.input === undefined) return
      this.active.set(event.toolCallId, event)
    }
    this.emit(event)
  }

  chunk(chunk: TextStreamPart<ToolSet>): void {
    if (chunk.type === 'tool-input-start') {
      this.start(chunk.id, chunk.toolName, 'preparing')
    } else if (chunk.type === 'tool-call') {
      if (chunk.providerExecuted || !this.active.has(chunk.toolCallId))
        this.start(chunk.toolCallId, chunk.toolName, chunk.providerExecuted ? 'running' : 'preparing', chunk.input)
    } else if (chunk.type === 'tool-approval-request') {
      this.start(chunk.toolCall.toolCallId, chunk.toolCall.toolName, 'waiting', chunk.toolCall.input)
    } else if (chunk.type === 'tool-result' && !chunk.preliminary) {
      this.end(chunk.toolCallId, chunk.toolName, { output: chunk.output })
    } else if (chunk.type === 'tool-error') {
      this.end(chunk.toolCallId, chunk.toolName, {
        error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
      })
    } else if (chunk.type === 'tool-output-denied') {
      this.end(chunk.toolCallId, chunk.toolName, { error: 'Tool call was declined.' })
    }
  }

  start(toolCallId: string, toolName: string, phase: 'preparing' | 'waiting' | 'running', input?: unknown): void {
    this.report({
      type: 'tool-execution-start',
      toolCallId,
      toolName,
      phase,
      input,
      started: new ZonedDateTime().epochMilliseconds,
    })
  }

  end(toolCallId: string, toolName: string, result: { output?: unknown; error?: string }): void {
    this.report({
      type: 'tool-execution-end',
      toolCallId,
      toolName,
      ...result,
      finished: new ZonedDateTime().epochMilliseconds,
    })
  }

  finishIncomplete(error: string): void {
    for (const call of this.active.values()) this.end(call.toolCallId, call.toolName, { error })
  }
}

/** Observe every executable tool, including tools that never print command output. */
export function observeTools<T extends Record<string, Executable>>(
  tools: T,
  emit: (event: ToolExecutionEvent) => void,
  abortSignal?: AbortSignal,
  executions?: Promise<unknown>[],
): T {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, tool]) => {
      const execute = tool.execute as ((...args: unknown[]) => unknown) | undefined
      if (!execute) return [toolName, tool]
      const run = async (input: unknown, ...rest: unknown[]) => {
        abortSignal?.throwIfAborted()
        const options = rest[0] as { toolCallId?: string } | undefined
        const toolCallId = options?.toolCallId ?? crypto.randomUUID()
        emit({
          type: 'tool-execution-start',
          phase: 'running',
          toolName,
          toolCallId,
          input,
          started: new ZonedDateTime().epochMilliseconds,
        })
        try {
          const output = await execute(input, ...rest)
          emit({
            type: 'tool-execution-end',
            toolName,
            toolCallId,
            output,
            finished: new ZonedDateTime().epochMilliseconds,
          })
          return output
        } catch (error) {
          emit({
            type: 'tool-execution-end',
            toolName,
            toolCallId,
            error: error instanceof Error ? error.message : String(error),
            finished: new ZonedDateTime().epochMilliseconds,
          })
          throw error
        }
      }
      return [
        toolName,
        {
          ...tool,
          execute: (input: unknown, ...rest: unknown[]) => {
            const result = run(input, ...rest)
            executions?.push(result)
            return result
          },
        },
      ]
    }),
  ) as T
}
