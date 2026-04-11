import type { CommandArgs, CommandDescription } from '../commands.d.ts'
import type { Prompt } from './Prompt.ts'
import { processPrompts } from './processPrompts.ts'
import { CommandResult } from './CommandResult.ts'

/**
 * Abstract base class for all tasks
 * Provides a consistent interface for task execution
 *
 * Note: TypeScript cannot enforce static abstract properties.
 * Subclasses MUST define: static description: CommandDescription
 *
 * ## Two ways to implement tasks:
 *
 * ### 1. Override `run()` directly (traditional, non-interactive tasks)
 * ```typescript
 * async run(args: CommandArgs): Promise<CommandResult> {
 *   // do work
 *   return CommandResult.success()
 * }
 * ```
 *
 * ### 2. Override `runWithPrompts()` for interactive tasks
 * ```typescript
 * async *runWithPrompts(args: CommandArgs): AsyncGenerator<Prompt, CommandResult, string> {
 *   const name = yield Prompt.text('name', 'What is your name?')
 *   return CommandResult.success({ name })
 * }
 *
 * async run(args: CommandArgs): Promise<CommandResult> {
 *   return this.processPrompts(args)
 * }
 * ```
 */
export abstract class Command {
  /**
   * Task metadata - must be overridden in subclasses as a static property
   * @example
   * static override description: CommandDescription = {
   *   name: 'task:name',
   *   description: 'What this task does'
   * }
   */
  static readonly description: CommandDescription

  /**
   * Run the task with given arguments
   * Must be implemented by subclasses
   */
  abstract run(args: CommandArgs): Promise<CommandResult>

  /**
   * Run the task with interactive prompts
   *
   * Override this for interactive tasks. Yield Prompt objects when
   * user input is needed - the response is returned from the yield.
   *
   * Use context.output.log() for one-way notifications (progress, etc.)
   *
   * @example
   * async *runWithPrompts({ context }: CommandArgs): AsyncGenerator<Prompt, CommandResult, string> {
   *   const name = yield Prompt.text('name', 'What is your name?')
   *   context.output.log(`Hello, ${name}!`)
   *   return CommandResult.success({ name })
   * }
   */
  // deno-lint-ignore require-yield
  async *runWithPrompts(_args: CommandArgs): AsyncGenerator<Prompt, CommandResult, string> {
    // Default: no prompts, return success
    // Override this for interactive tasks
    return CommandResult.success()
  }

  /**
   * Helper for interactive tasks: process prompts from runWithPrompts()
   *
   * Call this from run() in interactive tasks:
   * ```typescript
   * async run(args: CommandArgs): Promise<CommandResult> {
   *   return this.processPrompts(args)
   * }
   * ```
   */
  protected processPrompts<T>(args: CommandArgs): Promise<CommandResult<T>> {
    return processPrompts(this.runWithPrompts(args)) as Promise<CommandResult<T>>
  }
}
