import type { OutputHandler, PlanStep } from './OutputHandler.ts'

/**
 * What a command's output looks like to a host that renders it somewhere
 * other than a terminal: one event per line, per streamed piece of text,
 * and per command boundary in the composition tree.
 */
export type OutputEvent =
  | { type: 'line'; text: string; level: 'log' | 'error'; command: string | null; depth: number }
  | { type: 'text'; text: string; command: string | null; depth: number }
  | { type: 'plan'; steps: PlanStep[]; command: string | null; depth: number }
  | { type: 'stage'; id: string; label: string; detail: string | null; command: string | null; depth: number }
  | { type: 'tick'; done: number; total: number | null; unit: string | null; command: string | null; depth: number }
  | { type: 'command-start'; command: string; depth: number }
  | { type: 'command-end'; command: string; depth: number; status: 'success' | 'fail' | 'error' }

/** Terminal color codes, which a browser has no use for. */
const ANSI = /\x1b\[[0-9;]*m/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/**
 * Output handler that hands every line, streamed piece, and command
 * boundary to a sink as an event. The words are the same ones the terminal
 * prints, minus their colors; the boundaries come from `child()`, which
 * the command service calls for every composed run, so a host sees the
 * pipeline's stages without the commands knowing they are watched.
 */
export class EventOutput implements OutputHandler {
  private readonly sink: (event: OutputEvent) => void
  private readonly command: string | null
  private readonly depth: number

  constructor(sink: (event: OutputEvent) => void, command: string | null = null, depth = 0) {
    this.sink = sink
    this.command = command
    this.depth = depth
  }

  log(message: string): void {
    this.sink({ type: 'line', text: stripAnsi(message), level: 'log', command: this.command, depth: this.depth })
  }

  write(text: string): void {
    this.sink({ type: 'text', text: stripAnsi(text), command: this.command, depth: this.depth })
  }

  error(message: string): void {
    this.sink({ type: 'line', text: stripAnsi(message), level: 'error', command: this.command, depth: this.depth })
  }

  table(data: unknown): void {
    this.log(JSON.stringify(data))
  }

  plan(steps: PlanStep[]): void {
    this.sink({ type: 'plan', steps: steps.map((s) => ({ ...s })), command: this.command, depth: this.depth })
  }

  stage(id: string, label: string, detail?: string): void {
    this.sink({ type: 'stage', id, label, detail: detail ?? null, command: this.command, depth: this.depth })
  }

  tick(done: number, total: number | null, unit?: string): void {
    this.sink({ type: 'tick', done, total, unit: unit ?? null, command: this.command, depth: this.depth })
  }

  commandStart(): void {
    if (this.command) this.sink({ type: 'command-start', command: this.command, depth: this.depth })
  }

  commandEnd(status: 'success' | 'fail' | 'error'): void {
    if (this.command) this.sink({ type: 'command-end', command: this.command, depth: this.depth, status })
  }

  child(commandName?: string): OutputHandler {
    return new EventOutput(this.sink, commandName ?? this.command, this.depth + 1)
  }
}
