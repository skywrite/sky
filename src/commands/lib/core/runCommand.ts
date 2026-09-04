import type { Args } from '#commands/lib/commands.d.ts'
import { EventOutput, type OutputEvent } from '../output/EventOutput.ts'
import type {
  ConfirmPrompt,
  FormAnswers,
  FormPrompt,
  MultiselectPrompt,
  PlaceAnswer,
  PlacePrompt,
  Prompter,
  PromptRequest,
  SelectPrompt,
  TextPrompt,
} from '../prompt/Prompter.ts'
import type CommandContext from './CommandContext.ts'
import type { CommandResult } from './CommandResult.ts'
import CommandService from './CommandService.ts'

/**
 * A command run as one stream: everything it reports, every question it
 * asks, then its result. This is the one place a generator lives in the
 * framework. Commands themselves stay plain: they call `output.stage()`,
 * `output.tick()`, `output.write()` and `await context.prompt.…`, and this
 * turns those pushes into a pull a host reads with `for await`.
 *
 *   for await (const event of runCommand('meeting:new', { context, args })) …
 *
 * A question arrives as a `prompt` event carrying its own `reply`; the
 * command's await resolves when the host calls it. Stopping the loop early
 * cancels the run: the command's signal fires and every open question is
 * answered null, so it winds down at its next check.
 */

export interface PromptEvent {
  type: 'prompt'
  id: string
  request: PromptRequest
  /** Answer the question; a second call is ignored */
  reply: (answer: unknown) => void
}

export type RunEvent = OutputEvent | PromptEvent

export interface RunOptions {
  /** The host's context: config, env, secrets, clock. Its output and prompt are replaced by the runner's. */
  context: CommandContext
  args?: Record<string, unknown>
  /** What the host states outright, as the CLI would have typed it — a stated `when` beats an extracted one */
  rawArgs?: Args
  /** The host's cancel */
  signal?: AbortSignal
}

/** Questions become events with a reply; a cancel answers every open one with null. */
export class EventPrompter implements Prompter {
  readonly interactive = true
  private readonly pending = new Map<string, (answer: unknown) => void>()
  private counter = 0

  constructor(private readonly push: (event: PromptEvent) => void) {}

  private ask<T>(request: PromptRequest): Promise<T | null> {
    const id = `p${++this.counter}`
    return new Promise<T | null>((resolve) => {
      const reply = (answer: unknown) => {
        if (this.pending.delete(id)) resolve(answer as T | null)
      }
      this.pending.set(id, reply)
      this.push({ type: 'prompt', id, request, reply })
    })
  }

  text(prompt: TextPrompt): Promise<string | null> {
    return this.ask<string>({ kind: 'text', prompt })
  }

  confirm(prompt: ConfirmPrompt): Promise<boolean | null> {
    return this.ask<boolean>({ kind: 'confirm', prompt })
  }

  select(prompt: SelectPrompt): Promise<string | null> {
    return this.ask<string>({ kind: 'select', prompt })
  }

  multiselect(prompt: MultiselectPrompt): Promise<string[] | null> {
    return this.ask<string[]>({ kind: 'multiselect', prompt })
  }

  place(prompt: PlacePrompt): Promise<PlaceAnswer | null> {
    return this.ask<PlaceAnswer>({ kind: 'place', prompt })
  }

  form(prompt: FormPrompt): Promise<FormAnswers | null> {
    return this.ask<FormAnswers>({ kind: 'form', prompt })
  }

  get waiting(): boolean {
    return this.pending.size > 0
  }

  cancel(): void {
    // A reply removes its own entry; deleting the visited entry mid-iteration is safe on a Map.
    for (const reply of this.pending.values()) reply(null)
  }
}

export async function* runCommand(name: string, options: RunOptions): AsyncGenerator<RunEvent, CommandResult, void> {
  const queue: RunEvent[] = []
  let wake: (() => void) | null = null
  const push = (event: RunEvent) => {
    queue.push(event)
    wake?.()
    wake = null
  }

  // The run's own signal: fired by the host's, or by the host walking away.
  const controller = new AbortController()
  const onHostAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', onHostAbort, { once: true })
  const prompter = new EventPrompter(push)
  controller.signal.addEventListener('abort', () => prompter.cancel(), { once: true })

  const context = options.context.fork({
    output: new EventOutput(push),
    prompt: prompter,
    signal: controller.signal,
  })
  const tasks = new CommandService(context, {}, options.rawArgs)

  let settled = false
  const run = tasks.run(name, options.args)
  const mark = () => {
    settled = true
    wake?.()
    wake = null
  }
  run.then(mark, mark)

  try {
    while (true) {
      while (queue.length > 0) yield queue.shift()!
      if (settled) break
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
    while (queue.length > 0) yield queue.shift()!
    return await run
  } finally {
    controller.abort()
    options.signal?.removeEventListener('abort', onHostAbort)
  }
}
